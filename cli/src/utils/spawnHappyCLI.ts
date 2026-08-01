import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Cross-platform HAPI CLI spawning utility
 *
 * ## Background
 *
 * HAPI CLI runs in two modes:
 * 1. **Compiled binary**: A single executable built with `bun build --compile`
 * 2. **Development mode**: Running TypeScript directly via `bun`
 *
 * ## Execution Modes
 *
 * **Compiled Binary (Production):**
 * - The executable is self-contained and runs directly
 * - `process.execPath` points to the compiled binary itself
 * - No additional entrypoint needed - just pass args to `process.execPath`
 *
 * **Development Mode:**
 * - Running via `bun src/index.ts`
 * - Spawn child processes using the same runtime with `src/index.ts` entrypoint
 *
 * ## Cross-Platform Support
 *
 * This utility handles spawning HAPI CLI subprocesses (for runner processes)
 * in a cross-platform way, detecting the current runtime mode and using
 * the appropriate command and arguments.
 */

import { spawn, SpawnOptions, type ChildProcess } from 'child_process';
import { join, isAbsolute, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBunCompiled, projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';
import { existsSync } from 'node:fs';

const HAPI_CLI_EXECUTABLE_ENV = 'HAPI_CLI_EXECUTABLE';

/**
 * Resolve the TypeScript entrypoint for development mode.
 */
function resolveEntrypoint(projectRoot: string): string {
  const srcEntrypoint = join(projectRoot, 'src', 'index.ts');
  if (existsSync(srcEntrypoint)) {
    return srcEntrypoint;
  }

  throw new Error('No CLI entrypoint found (expected src/index.ts)');
}

export interface HappyCliCommand {
  command: string;
  args: string[];
}

function isCrossPlatformAbsolutePath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value);
}

function resolveInvokedCwd(cwd: SpawnOptions['cwd']): string {
  if (cwd instanceof URL) {
    return fileURLToPath(cwd);
  }

  if (typeof cwd === 'string' && cwd.trim().length > 0) {
    const normalizedCwd = cwd.trim();
    return isCrossPlatformAbsolutePath(normalizedCwd) ? normalizedCwd : resolve(normalizedCwd);
  }

  const inheritedInvokedCwd = process.env.HAPI_INVOKED_CWD?.trim();
  if (inheritedInvokedCwd && isCrossPlatformAbsolutePath(inheritedInvokedCwd)) {
    return inheritedInvokedCwd;
  }

  return process.cwd();
}

/**
 * Resolve the executable to use when re-spawning HAPI from a compiled binary.
 *
 * Windows in-place binary patches (e.g. self-update / resume-recovery) replace
 * the file at a versioned path (`resume-recovery-0.17.2\hapi.exe`) while the
 * currently-running process may still be pointed at an older `process.execPath`
 * that no longer exists on disk once the old version's directory is cleaned up.
 * Prefer, in order:
 *   1. An inherited `HAPI_CLI_EXECUTABLE` override, when it points to a binary
 *      that still exists (set by a parent HAPI process — see spawnHappyCLI).
 *   2. `process.argv[0]` / `Bun.argv[0]`, when it is an absolute path that
 *      exists (the actual binary the current process was launched from).
 *   3. `process.execPath` as the final fallback.
 */
export function resolveHappyCliExecutable(): string {
  const override = process.env[HAPI_CLI_EXECUTABLE_ENV]?.trim();
  if (override && isCrossPlatformAbsolutePath(override) && existsSync(override)) {
    return override;
  }

  const argv0 = process.argv[0]?.trim();
  if (argv0 && isCrossPlatformAbsolutePath(argv0) && existsSync(argv0)) {
    return argv0;
  }

  const bunArgv0 = globalThis.Bun?.argv?.[0]?.trim();
  if (bunArgv0 && isCrossPlatformAbsolutePath(bunArgv0) && existsSync(bunArgv0)) {
    return bunArgv0;
  }

  return process.execPath;
}

export function getHappyCliCommand(args: string[]): HappyCliCommand {
  // Compiled binary mode: just use the executable directly
  if (isBunCompiled()) {
    return {
      command: resolveHappyCliExecutable(),
      args
    };
  }

  // Development mode: spawn with TypeScript entrypoint
  const projectRoot = projectPath();
  const entrypoint = resolveEntrypoint(projectRoot);
  const isBunRuntime = Boolean((process.versions as Record<string, string | undefined>).bun);

  if (isBunRuntime) {
    // Bun can run TypeScript directly.
    // Force Bun's cwd to the CLI project root so alias resolution via bunfig.toml
    // keeps working even when external tools launch HAPI from another workspace.
    return {
      command: process.execPath,
      args: ['--cwd', projectRoot, entrypoint, ...args]
    };
  }

  // Node.js fallback: preserve execArgv (for compatibility)
  return {
    command: process.execPath,
    args: [...process.execArgv, entrypoint, ...args]
  };
}

export function spawnHappyCLI(args: string[], options: SpawnOptions = {}): ChildProcess {

  let directory: string | URL | undefined;
  if ('cwd' in options) {
    directory = options.cwd
  } else {
    directory = process.cwd()
  }
  // Note: We're executing the current runtime with the calculated entrypoint path below,
  // bypassing the 'hapi' wrapper that would normally be found in the shell's PATH.
  // However, we log it as 'hapi' here because other engineers are typically looking
  // for when "hapi" was started and don't care about the underlying node process
  // details and flags we use to achieve the same result.
  logger.debug('[SPAWN HAPI CLI] Spawning HAPI process');

  const compiledMode = isBunCompiled();
  const { command: spawnCommand, args: spawnArgs } = getHappyCliCommand(args);

  // Sanity check that the entrypoint path exists
  if (!compiledMode) {
    const entrypoint = spawnArgs.find((arg) => arg.endsWith('index.ts'));
    if (entrypoint && !existsSync(entrypoint)) {
      const errorMessage = `Entrypoint ${entrypoint} does not exist`;
      logger.debug(`[SPAWN HAPI CLI] ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  // On Windows, detached processes allocate a new console window by default.
  // windowsHide: true suppresses this to prevent cmd windows from accumulating.
  const finalOptions: SpawnOptions = { ...options };
  const finalEnv = { ...process.env, ...options.env };
  let shouldSetEnv = false;
  if (compiledMode) {
    // Propagate the resolved executable so any HAPI process spawned by this
    // child (e.g. a runner re-spawning itself) reuses the same binary instead
    // of re-resolving from a possibly-stale process.execPath.
    finalEnv[HAPI_CLI_EXECUTABLE_ENV] = spawnCommand;
    shouldSetEnv = true;
  } else {
    const invokedCwd = finalEnv.HAPI_INVOKED_CWD?.trim();
    const hasExplicitCwd = 'cwd' in options && options.cwd !== undefined;
    finalEnv.HAPI_INVOKED_CWD = hasExplicitCwd
      ? resolveInvokedCwd(options.cwd)
      : invokedCwd && isCrossPlatformAbsolutePath(invokedCwd)
        ? invokedCwd
        : resolveInvokedCwd(options.cwd);
    shouldSetEnv = true;
  }
  if (shouldSetEnv) {
    finalOptions.env = finalEnv;
  }
  if (process.platform === 'win32' && options.detached) {
    finalOptions.windowsHide = true;
  }
  return spawn(spawnCommand, spawnArgs, finalOptions);
}
