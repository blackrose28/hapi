/**
 * Integration tests for runner HTTP control system
 * 
 * Tests the full flow of runner startup, session tracking, and shutdown
 * 
 * The suite owns an isolated Hub database, enrolled Runner credential, and Hub
 * process. A fixture startup failure fails the suite instead of silently skipping it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { configuration } from '@/configuration';
import type { RunnerLocallyPersistedState } from '@/persistence';
import { Metadata } from '@/api/types';
import { isProcessAlive, isWindows, killProcess, killProcessByChildProcess } from '@/utils/process';
import { createRunnerProfile, readRunnerProfileState, resolveRunnerProfilePaths } from './profile';

// Utility to wait for condition
async function waitFor(
  condition: () => Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to reserve integration Hub port'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function spawnIntegrationCli(args: string[], options: SpawnOptions = {}): ChildProcess {
  return spawn('bun', ['--cwd', process.cwd(), join(process.cwd(), 'src', 'index.ts'), ...args], {
    ...options,
    env: { ...process.env, ...options.env }
  });
}

describe('Runner Integration Tests', { timeout: 20_000 }, () => {
  let runnerPid: number;
  let hubProcess: ChildProcess;
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'hapi-runner-integration-'));
  const profile = `integration-${process.pid}`;
  const profilePaths = resolveRunnerProfilePaths(configuration.happyHomeDir, profile);

  const readRunnerState = () => readRunnerProfileState<RunnerLocallyPersistedState>(profilePaths);
  async function runnerPost(route: string, body: unknown = {}): Promise<any> {
    const current = await readRunnerState();
    if (!current?.httpPort) throw new Error('Runner is not running');
    const response = await fetch(`http://127.0.0.1:${current.httpPort}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Runner control request failed: ${response.status} ${await response.text()}`);
    return response.json();
  }
  const listRunnerSessions = async () => (await runnerPost('/list')).children;
  const stopRunnerSession = async (sessionId: string) => Boolean((await runnerPost('/stop-session', { sessionId })).success);
  const spawnRunnerSession = async (directory: string, approvedNewDirectoryCreation?: string) => runnerPost('/spawn-session', { directory, approvedNewDirectoryCreation });
  const stopRunnerHttp = async () => { await runnerPost('/stop'); };
  const notifyRunnerSessionStarted = async (sessionId: string, metadata: Metadata) => { await runnerPost('/session-started', { sessionId, metadata }); };
  const clearRunnerState = async () => { await import('node:fs/promises').then(({ rm }) => rm(profilePaths.stateFile, { force: true })); };
  const stopRunner = async () => {
    const current = await readRunnerState();
    if (!current) return;
    await runnerPost('/stop').catch(() => killProcess(current.pid, true));
    await waitFor(async () => !isProcessAlive(current.pid), 5_000).catch(() => {});
  };

  beforeAll(async () => {
    const port = await reservePort();
    const hubUrl = `http://127.0.0.1:${port}`;
    const databasePath = join(fixtureRoot, 'hub.db');
    const pepper = 'runner-integration-pepper-32-characters-minimum';
    const organizationId = 'runner-integration';
    const machineId = `runner-integration-machine-${process.pid}`;
    const descriptorPath = join(fixtureRoot, 'runner.json');

    let hubOutput = '';
    hubProcess = spawn('bun', ['src/testing/runnerIntegrationServer.ts', '--no-relay'], {
      cwd: join(process.cwd(), '..', 'hub'),
      env: {
        ...process.env,
        HAPI_HOME: join(fixtureRoot, 'hub-home'),
        DB_PATH: databasePath,
        HAPI_LISTEN_HOST: '127.0.0.1',
        HAPI_LISTEN_PORT: String(port),
        HAPI_PUBLIC_URL: `https://127.0.0.1:${port}`,
        CORS_ORIGINS: `https://127.0.0.1:${port}`,
        HAPI_ORGANIZATION_ID: organizationId,
        HAPI_ORGANIZATION_NAME: 'Runner Integration',
        HAPI_OIDC_ISSUER: 'https://oidc.invalid/realms/runner-integration',
        HAPI_OIDC_CLIENT_ID: 'runner-integration',
        HAPI_BOOTSTRAP_ADMIN_EMAIL: 'runner-integration@example.com',
        HAPI_AUTH_PEPPER: pepper,
        HAPI_RUNNER_INTEGRATION_DESCRIPTOR: descriptorPath,
        HAPI_RUNNER_INTEGRATION_PROFILE: profile,
        HAPI_RUNNER_INTEGRATION_MACHINE_ID: machineId
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    hubProcess.stdout?.on('data', (data) => { hubOutput += data.toString(); });
    hubProcess.stderr?.on('data', (data) => { hubOutput += data.toString(); });
    await waitFor(async () => {
      if (hubProcess.exitCode !== null) {
        throw new Error(`Integration Hub exited during startup (${hubProcess.exitCode}):\n${hubOutput}`);
      }
      try {
        return existsSync(descriptorPath)
          && (await fetch(`${hubUrl}/health`, { signal: AbortSignal.timeout(500) })).ok;
      } catch {
        return false;
      }
    }, 15_000, 100);

    const enrolled = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
      runnerId: string;
      generation: number;
      credential: { credentialId: string; secret: string };
    };
    process.env.HAPI_TEST_RUNNER_ORGANIZATION_ID = organizationId;
    process.env.HAPI_TEST_RUNNER_ID = enrolled.runnerId;
    process.env.HAPI_TEST_RUNNER_MACHINE_ID = machineId;
    process.env.HAPI_TEST_RUNNER_CREDENTIAL_ID = enrolled.credential.credentialId;
    process.env.HAPI_TEST_RUNNER_CREDENTIAL_SECRET = enrolled.credential.secret;
    process.env.HAPI_TEST_RUNNER_CREDENTIAL_GENERATION = String(enrolled.generation);
    process.env.HAPI_RUNNER_HEARTBEAT_INTERVAL = '1000';
    configuration._setApiUrl(hubUrl);

    await createRunnerProfile(configuration.happyHomeDir, {
      version: 1,
      profile,
      hubUrl: configuration.apiUrl,
      organizationId: process.env.HAPI_TEST_RUNNER_ORGANIZATION_ID ?? 'integration-test',
      runnerId: process.env.HAPI_TEST_RUNNER_ID ?? 'integration-test',
      machineId: process.env.HAPI_TEST_RUNNER_MACHINE_ID!
    }, {
      version: 1,
      credential: { credentialId: process.env.HAPI_TEST_RUNNER_CREDENTIAL_ID!, secret: process.env.HAPI_TEST_RUNNER_CREDENTIAL_SECRET! },
      generation: Number(process.env.HAPI_TEST_RUNNER_CREDENTIAL_GENERATION ?? 1)
    });
  });

  afterAll(async () => {
    await import('node:fs/promises').then(({ rm }) => rm(profilePaths.root, { recursive: true, force: true }));
    if (hubProcess?.exitCode === null) {
      hubProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => hubProcess.once('exit', () => resolve()));
    }
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // First ensure no runner is running by checking PID in metadata file
    await stopRunner()
    
    // Start fresh runner for this test
    // This will return and start a background process - we don't need to wait for it
    let startOutput = '';
    const startProcess = spawnIntegrationCli(['runner', 'start', '--profile', profile, '--workspace-root', fixtureRoot], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    startProcess.stdout?.on('data', (data) => { startOutput += data.toString(); });
    startProcess.stderr?.on('data', (data) => { startOutput += data.toString(); });
    
    // Wait for runner to write its state file (it needs to auth, setup, and start server)
    try {
      await waitFor(async () => {
        const state = await readRunnerState();
        return state !== null;
      }, 20_000, 250);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nRunner start output:\n${startOutput}`);
    }
    
    const runnerState = await readRunnerState();
    if (!runnerState) {
      throw new Error('Runner failed to start within timeout');
    }
    runnerPid = runnerState.pid;

    console.log(`[TEST] Runner started for test: PID=${runnerPid}`);
    console.log(`[TEST] Runner log file: ${runnerState?.runnerLogPath}`);
  }, 30_000);

  afterEach(async () => {
    await stopRunner()
  }, 20_000);

  it('should list sessions (initially empty)', async () => {
    const sessions = await listRunnerSessions();
    expect(sessions).toEqual([]);
  });

  it('should track session-started webhook from terminal session', async () => {
    // Simulate a terminal-started session reporting to runner
    const mockMetadata: Metadata = {
      path: '/test/path',
      host: 'test-host',
      homeDir: '/test/home',
      happyHomeDir: '/test/happy-home',
      happyLibDir: '/test/happy-lib',
      happyToolsDir: '/test/happy-tools',
      hostPid: 99999,
      startedBy: 'terminal',
      machineId: 'test-machine-123'
    };

    await notifyRunnerSessionStarted('test-session-123', mockMetadata);

    // Verify session is tracked
    const sessions = await listRunnerSessions();
    expect(sessions).toHaveLength(1);
    
    const tracked = sessions[0];
    expect(tracked.startedBy).toBe('hapi directly - likely by user from terminal');
    expect(tracked.happySessionId).toBe('test-session-123');
    expect(tracked.pid).toBe(99999);
  });

  it('should spawn & stop a session via HTTP (not testing RPC route, but similar enough)', async () => {
    const response = await spawnRunnerSession('/tmp', 'spawned-test-456');

    expect(response).toHaveProperty('success', true);
    expect(response).toHaveProperty('sessionId');

    // Verify session is tracked
    const sessions = await listRunnerSessions();
    const spawnedSession = sessions.find(
      (s: any) => s.happySessionId === response.sessionId
    );
    
    expect(spawnedSession).toBeDefined();
    expect(spawnedSession.startedBy).toBe('runner');
    
    // Clean up - stop the spawned session
    expect(spawnedSession.happySessionId).toBeDefined();
    await stopRunnerSession(spawnedSession.happySessionId);
  });

  it('stress test: spawn / stop', { timeout: 60_000 }, async () => {
    const promises = [];
    const sessionCount = 5;
    for (let i = 0; i < sessionCount; i++) {
      promises.push(spawnRunnerSession('/tmp'));
    }

    // Wait for all sessions to be spawned
    const results = await Promise.all(promises);
    const sessionIds = results.map(r => r.sessionId);

    const sessions = await listRunnerSessions();
    expect(sessions).toHaveLength(sessionCount);

    // Stop all sessions
    const stopResults = await Promise.all(sessionIds.map(sessionId => stopRunnerSession(sessionId)));
    expect(stopResults.every(r => r), 'Not all sessions reported stopped').toBe(true);

    // Verify all sessions are stopped
    const emptySessions = await listRunnerSessions();
    expect(emptySessions).toHaveLength(0);
  });

  it('should handle runner stop request gracefully', async () => {    
    await stopRunnerHttp();

    // Verify metadata file is cleaned up
    await waitFor(async () => !existsSync(profilePaths.stateFile), 1000);
  });

  it('should track both runner-spawned and terminal sessions', async () => {
    const terminalHappyProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore'
    });
    if (!terminalHappyProcess || !terminalHappyProcess.pid) {
      throw new Error('Failed to spawn terminal hapi process');
    }
    await notifyRunnerSessionStarted('terminal-session-aaa', {
      path: '/tmp',
      host: 'runner-integration',
      homeDir: '/tmp',
      happyHomeDir: profilePaths.root,
      happyLibDir: '/tmp',
      happyToolsDir: '/tmp',
      hostPid: terminalHappyProcess.pid,
      startedBy: 'terminal',
      machineId: process.env.HAPI_TEST_RUNNER_MACHINE_ID!
    });

    // Spawn a runner session
    const spawnResponse = await spawnRunnerSession('/tmp', 'runner-session-bbb');

    // List all sessions
    const sessions = await listRunnerSessions();
    expect(sessions).toHaveLength(2);

    // Verify we have one of each type
    const terminalSession = sessions.find(
      (s: any) => s.pid === terminalHappyProcess.pid
    );
    const runnerSession = sessions.find(
      (s: any) => s.happySessionId === spawnResponse.sessionId
    );

    expect(terminalSession).toBeDefined();
    expect(terminalSession.startedBy).toBe('hapi directly - likely by user from terminal');
    
    expect(runnerSession).toBeDefined();
    expect(runnerSession.startedBy).toBe('runner');

    // Clean up both sessions
    await stopRunnerSession('terminal-session-aaa');
    await stopRunnerSession(runnerSession.happySessionId);
    
    // Also kill the terminal process directly to be sure
    try {
      await killProcessByChildProcess(terminalHappyProcess);
    } catch (e) {
      // Process might already be dead
    }
  });

  it('should update session metadata when webhook is called', async () => {
    // Spawn a session
    const spawnResponse = await spawnRunnerSession('/tmp');

    // Verify webhook was processed (session ID updated)
    const sessions = await listRunnerSessions();
    const session = sessions.find((s: any) => s.happySessionId === spawnResponse.sessionId);
    expect(session).toBeDefined();

    // Clean up
    await stopRunnerSession(spawnResponse.sessionId);
  });

  it('should not allow starting a second runner', async () => {
    const originalPid = runnerPid;
    const secondChild = spawnIntegrationCli(['runner', 'start', '--profile', profile, '--workspace-root', fixtureRoot], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await new Promise<void>((resolve) => {
      secondChild.on('exit', () => resolve());
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    const state = await readRunnerState();
    expect(state?.pid).toBe(originalPid);
    expect(isProcessAlive(originalPid)).toBe(true);
  });

  it('should handle concurrent session operations', async () => {
    // Spawn multiple sessions concurrently
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        spawnRunnerSession('/tmp')
      );
    }

    const results = await Promise.all(promises);
    
    // All should succeed
    results.forEach(res => {
      expect(res.success).toBe(true);
      expect(res.sessionId).toBeDefined();
    });

    // Collect session IDs for tracking
    const spawnedSessionIds = results.map(r => r.sessionId);

    // Give sessions time to report via webhook
    await new Promise(resolve => setTimeout(resolve, 1000));

    // List should show all sessions
    const sessions = await listRunnerSessions();
    const runnerSessions = sessions.filter(
      (s: any) => s.startedBy === 'runner' && spawnedSessionIds.includes(s.happySessionId)
    );
    expect(runnerSessions.length).toBeGreaterThanOrEqual(3);

    // Stop all spawned sessions
    for (const session of runnerSessions) {
      expect(session.happySessionId).toBeDefined();
      await stopRunnerSession(session.happySessionId);
    }
  });

  it('should die with logs when SIGKILL is sent', async () => {
    // SIGKILL test - runner should die immediately
    const logsDir = profilePaths.logsDir;
    const { readdirSync } = await import('fs');
    
    // Get initial log files
    const initialLogs = readdirSync(logsDir).filter(f => f.endsWith('-runner.log'));
    
    // Send SIGKILL to runner (force kill)
    await killProcess(runnerPid, true);
    
    // Wait for process to die
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check if process is dead
    const isDead = !isProcessAlive(runnerPid);
    expect(isDead).toBe(true);
    
    // Check that log file exists (it was created when runner started)
    const finalLogs = readdirSync(logsDir).filter(f => f.endsWith('-runner.log'));
    expect(finalLogs.length).toBeGreaterThanOrEqual(initialLogs.length);
    
    // The runner won't have time to write cleanup logs with SIGKILL
    console.log('[TEST] Runner killed with SIGKILL - no cleanup logs expected');
    
    // Clean up state file manually since runner couldn't do it
    await clearRunnerState();
  });

  it('should remove state when a graceful shutdown is requested', async () => {
    if (isWindows()) {
      await stopRunnerHttp();
    } else {
      await killProcess(runnerPid);
    }

    await waitFor(async () => !isProcessAlive(runnerPid) && !existsSync(profilePaths.stateFile), 10_000, 100);
  });

  it('should detect an installed CLI change and replace the old runner', { timeout: 45_000 }, async () => {
    const packagePath = join(process.cwd(), 'package.json');
    const originalTimes = statSync(packagePath);

    try {
      const initialState = await readRunnerState();
      expect(initialState).toBeDefined();
      const initialPid = initialState!.pid;
      expect(initialState!.workspaceRoot).toBe(fixtureRoot);

      const changedTime = new Date(originalTimes.mtimeMs + 10_000);
      utimesSync(packagePath, changedTime, changedTime);

      await waitFor(async () => {
        const state = await readRunnerState();
        return Boolean(state && state.pid !== initialPid && isProcessAlive(state.pid));
      }, 30_000, 250);
      const finalState = await readRunnerState();
      expect(finalState).toBeDefined();
      expect(finalState!.pid).not.toBe(initialPid);
      // Regression check: the self-restart on a stale-version detection must
      // carry the workspace root forward, not silently drop it (it used to
      // only forward --profile to the respawned `runner start`).
      expect(finalState!.workspaceRoot).toBe(fixtureRoot);
    } finally {
      await stopRunner();
      utimesSync(packagePath, originalTimes.atime, originalTimes.mtime);
    }
  });

  // TODO: Add a test to see if a corrupted file will work
  
  // TODO: Test npm uninstall scenario - runner should gracefully handle when hapi is uninstalled
  // Current behavior: runner tries to spawn new runner on version mismatch but entrypoint is gone
  // Expected: runner should detect missing entrypoint and either exit cleanly or at minimum not respawn infinitely
});
