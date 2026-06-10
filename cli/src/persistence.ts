import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Minimal persistence functions for HAPI CLI
 * 
 * Handles settings, encryption key, and runner state storage in ~/.hapi/ (or HAPI_HOME override)
 */

import { FileHandle } from 'node:fs/promises'
import { readFile, writeFile, mkdir, open, unlink, rename, rm, stat } from 'node:fs/promises'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { configuration } from '@/configuration'
import { isProcessAlive } from '@/utils/process';
import { getCliArgs } from '@/utils/cliArgs';
import { readRunnerProfileState, resolveRunnerProfilePaths, writeRunnerProfileState, type RunnerProfilePaths } from '@/runner/profile';

interface Settings {
  // This ID is used as the actual database ID on the server
  // All machine operations use this ID
  machineId?: string
  machineIdConfirmedByServer?: boolean
  runnerAutoStartWhenRunningHappy?: boolean
  // API URL for server connections (priority: env HAPI_API_URL > this > default)
  apiUrl?: string
  // Legacy field name (for migration, read-only)
  serverUrl?: string
}

const defaultSettings: Settings = {}

/**
 * Runner state persisted locally (different from API RunnerState)
 * This is written to disk by the runner to track its local process state
 */
export interface RunnerLocallyPersistedState {
  pid: number;
  httpPort: number;
  startTime: string;
  startedWithCliVersion: string;
  startedWithCliMtimeMs?: number;
  startedWithApiUrl?: string;
  startedWithMachineId?: string;
  workspaceRoot?: string;
  startedWithCliApiTokenHash?: string;
  /**
   * Original process.argv.slice(2) of the runner process at start time, e.g.
   * ['runner', 'start-sync', '--workspace-root', '/home/user/code'].
   * Used by the self-restart handoff so the replacement runner inherits the
   * same workspace-root / flag configuration instead of starting with defaults.
   */
  startedWithArgv?: string[];
  lastHeartbeat?: string;
  runnerLogPath?: string;
  /**
   * Snapshot of HAPI_DISABLE_VERSION_HANDOFF=1 at the time this runner
   * started. Lets a later `hapi runner start` invocation (from a shell where
   * the env var is NOT set, e.g. operator's interactive terminal vs a
   * systemd service that owns supervision) honour the running runner's
   * opt-out instead of treating mtime drift as a reason to kill it.
   *
   * Codex review #814 [Major]: env-only check in controlClient meant the
   * supervised use case (env set on service only) would still trigger a
   * mid-rebuild stop. Persisting this fixes that.
   */
  startedWithVersionHandoffDisabled?: boolean;
}

export async function readSettings(): Promise<Settings> {
  if (!existsSync(configuration.settingsFile)) {
    return { ...defaultSettings }
  }

  try {
    const content = await readFile(configuration.settingsFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return { ...defaultSettings }
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  if (!existsSync(configuration.happyHomeDir)) {
    await mkdir(configuration.happyHomeDir, { recursive: true })
  }

  await writeFile(configuration.settingsFile, JSON.stringify(settings, null, 2))
}

/**
 * Atomically update settings with multi-process safety via file locking
 * @param updater Function that takes current settings and returns updated settings
 * @returns The updated settings
 */
export async function updateSettings(
  updater: (current: Settings) => Settings | Promise<Settings>
): Promise<Settings> {
  // Timing constants
  const LOCK_RETRY_INTERVAL_MS = 100;  // How long to wait between lock attempts
  const MAX_LOCK_ATTEMPTS = 50;        // Maximum number of attempts (5 seconds total)
  const STALE_LOCK_TIMEOUT_MS = 10000; // Consider lock stale after 10 seconds

  if (!existsSync(configuration.happyHomeDir)) {
    await mkdir(configuration.happyHomeDir, { recursive: true });
  }

  const lockFile = configuration.settingsFile + '.lock';
  const tmpFile = configuration.settingsFile + '.tmp';
  let fileHandle;
  let attempts = 0;

  // Acquire exclusive lock with retries
  while (attempts < MAX_LOCK_ATTEMPTS) {
    try {
      // 'wx' = create exclusively, fail if exists (cross-platform compatible)
      fileHandle = await open(lockFile, 'wx');
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock file exists, wait and retry
        attempts++;
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));

        // Check for stale lock
        try {
          const stats = await stat(lockFile);
          if (Date.now() - stats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
            await unlink(lockFile).catch(() => { });
          }
        } catch { }
      } else {
        throw err;
      }
    }
  }

  if (!fileHandle) {
    throw new Error(`Failed to acquire settings lock after ${MAX_LOCK_ATTEMPTS * LOCK_RETRY_INTERVAL_MS / 1000} seconds`);
  }

  try {
    // Read current settings with defaults
    const current = await readSettings() || { ...defaultSettings };

    // Apply update
    const updated = await updater(current);

    // Write atomically using rename
    await writeFile(tmpFile, JSON.stringify(updated, null, 2));
    await rename(tmpFile, configuration.settingsFile); // Atomic on POSIX

    return updated;
  } finally {
    // Release lock
    await fileHandle.close();
    await unlink(lockFile).catch(() => { }); // Remove lock file
  }
}

//
// Authentication
//

export async function writeCredentialsDataKey(credentials: { publicKey: Uint8Array, machineKey: Uint8Array, token: string }): Promise<void> {
  if (!existsSync(configuration.happyHomeDir)) {
    await mkdir(configuration.happyHomeDir, { recursive: true })
  }
  await writeFile(configuration.privateKeyFile, JSON.stringify({
    encryption: { publicKey: Buffer.from(credentials.publicKey).toString('base64'), machineKey: Buffer.from(credentials.machineKey).toString('base64') },
    token: credentials.token
  }, null, 2));
}

export async function clearCredentials(): Promise<void> {
  if (existsSync(configuration.privateKeyFile)) {
    await unlink(configuration.privateKeyFile);
  }
}

export async function clearMachineId(): Promise<void> {
  await updateSettings(settings => ({
    ...settings,
    machineId: undefined
  }));
}

/**
 * Resolve the profile name identifying the current process, if any:
 * either `runner start-sync --profile <name>` on the CLI (the runner itself,
 * when invoked directly rather than via the `runner start` wrapper that
 * pre-sets HAPI_HOME), or HAPI_RUNNER_PROFILE (set by the runner on every
 * session it spawns - see run.ts's spawnHappyCLI env block).
 */
function resolveActiveRunnerProfileName(): string | undefined {
  const args = getCliArgs();
  if (args[0] === 'runner') {
    const idx = args.indexOf('--profile');
    if (idx >= 0 && args[idx + 1]) {
      return args[idx + 1];
    }
    const eqArg = args.find((arg) => arg.startsWith('--profile='));
    if (eqArg) {
      return eqArg.slice('--profile='.length);
    }
  }
  return process.env.HAPI_RUNNER_PROFILE?.trim() || undefined;
}

/**
 * Resolve the profile-scoped state paths for the current process, if a
 * profile is identifiable. This must match run.ts's own resolution
 * (`readRunnerProfile(HAPI_PROFILE_BASE_HOME ?? configuration.happyHomeDir, profile)`)
 * so the runner's actual state file and this process's view of it agree -
 * this is what `notifyRunnerSessionStarted` and friends were missing,
 * causing every runner-spawned session to report "no state file found".
 */
function resolveActiveRunnerProfilePaths(): RunnerProfilePaths | null {
  const profileName = resolveActiveRunnerProfileName();
  if (!profileName) {
    return null;
  }
  const profileBaseHome = process.env.HAPI_PROFILE_BASE_HOME ?? configuration.happyHomeDir;
  try {
    return resolveRunnerProfilePaths(profileBaseHome, profileName);
  } catch {
    return null;
  }
}

/**
 * Read runner state from local file
 */
export async function readRunnerState(): Promise<RunnerLocallyPersistedState | null> {
  const profilePaths = resolveActiveRunnerProfilePaths();
  if (profilePaths) {
    return await readRunnerProfileState<RunnerLocallyPersistedState>(profilePaths);
  }

  try {
    if (!existsSync(configuration.runnerStateFile)) {
      return null;
    }
    const content = await readFile(configuration.runnerStateFile, 'utf-8');
    return JSON.parse(content) as RunnerLocallyPersistedState;
  } catch (error) {
    // State corrupted somehow :(
    console.error(`[PERSISTENCE] Runner state file corrupted: ${configuration.runnerStateFile}`, error);
    return null;
  }
}

/**
 * Write runner state to local file (profile-scoped when a profile is active)
 */
export async function writeRunnerState(state: RunnerLocallyPersistedState): Promise<void> {
  const profilePaths = resolveActiveRunnerProfilePaths();
  if (profilePaths) {
    await writeRunnerProfileState(profilePaths, state);
    return;
  }
  writeFileSync(configuration.runnerStateFile, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Clean up runner state file and lock file
 */
export async function clearRunnerState(): Promise<void> {
  const profilePaths = resolveActiveRunnerProfilePaths();
  if (profilePaths) {
    try {
      await rm(profilePaths.stateFile, { force: true });
      await rm(profilePaths.lockFile, { force: true });
    } catch {
      // Lock file might be held by running runner, ignore error
    }
    return;
  }

  if (existsSync(configuration.runnerStateFile)) {
    await unlink(configuration.runnerStateFile);
  }
  // Also clean up lock file if it exists (for stale cleanup)
  if (existsSync(configuration.runnerLockFile)) {
    try {
      await unlink(configuration.runnerLockFile);
    } catch {
      // Lock file might be held by running runner, ignore error
    }
  }
}

/**
 * Acquire an exclusive lock file for the runner.
 * The lock file proves the runner is running and prevents multiple instances.
 * Returns the file handle to hold for the runner's lifetime, or null if locked.
 */
export async function acquireRunnerLock(
  maxAttempts: number = 5,
  delayIncrementMs: number = 200
): Promise<FileHandle | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 'wx' ensures we only create if it doesn't exist (atomic lock acquisition)
      const fileHandle = await open(configuration.runnerLockFile, 'wx');
      // Write PID to lock file for debugging
      await fileHandle.writeFile(String(process.pid));
      return fileHandle;
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        // Lock file exists, check if process is still running
        try {
          const lockPid = readFileSync(configuration.runnerLockFile, 'utf-8').trim();
          if (lockPid && !isNaN(Number(lockPid))) {
            if (!isProcessAlive(Number(lockPid))) {
              // Process doesn't exist, remove stale lock
              unlinkSync(configuration.runnerLockFile);
              continue; // Retry acquisition
            }
          }
        } catch {
          // Can't read lock file, might be corrupted
        }
      }

      if (attempt === maxAttempts) {
        return null;
      }
      const delayMs = attempt * delayIncrementMs;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

/**
 * Release runner lock by closing handle and deleting lock file
 */
export async function releaseRunnerLock(lockHandle: FileHandle): Promise<void> {
  try {
    await lockHandle.close();
  } catch { }

  try {
    if (existsSync(configuration.runnerLockFile)) {
      unlinkSync(configuration.runnerLockFile);
    }
  } catch { }
}
