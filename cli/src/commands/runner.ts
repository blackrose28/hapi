import chalk from 'chalk'
import { existsSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { arch, hostname, platform } from 'node:os'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { startRunner } from '@/runner/run'
import {
    checkIfRunnerRunningAndCleanupStaleState,
    listRunnerSessions,
    stopRunner,
    stopRunnerSession
} from '@/runner/controlClient'
import { getLatestRunnerLog } from '@/ui/logger'
import { spawnHappyCLI, getHappyCliCommand } from '@/utils/spawnHappyCLI'
import { runDoctorCommand } from '@/ui/doctor'
import type { CommandDefinition } from './types'
import { exchangeRunnerEnrollment } from '@/runner/enrollmentClient'
import { createRunnerProfile, listEnrolledProfiles, resolveRunnerProfilePaths } from '@/runner/profile'
import { readRunnerProfileState } from '@/runner/profile'
import { configuration } from '@/configuration'
import type { RunnerLocallyPersistedState } from '@/persistence'
import { isProcessAlive } from '@/utils/process'
import { readdirSync } from 'node:fs'
import { promptChoiceOrNew, promptRequired } from '@/utils/prompt'

function option(args:string[],name:string):string|undefined { const direct=args.indexOf(name);if(direct>=0)return args[direct+1];return args.find((arg)=>arg.startsWith(`${name}=`))?.slice(name.length+1) }
async function profileState(args:string[]){const name=option(args,'--profile');if(!name)throw new Error('profile_required');const paths=resolveRunnerProfilePaths(configuration.happyHomeDir,name);return{name,paths,state:await readRunnerProfileState<RunnerLocallyPersistedState>(paths)}}
async function profilePost(args:string[],path:string,body:unknown={}){const {state}=await profileState(args);if(!state?.httpPort||!isProcessAlive(state.pid))throw new Error('runner_not_running');const response=await fetch(`http://127.0.0.1:${state.httpPort}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error('runner_request_failed');return response.json() as Promise<Record<string,unknown>>}

/**
 * Validates and normalizes a workspace-root path: expands `~` / `~/foo`
 * (the shell only expands unquoted tildes), resolves it to an absolute
 * path, and checks it's an existing directory.
 */
function normalizeWorkspaceRootInput(value: string): { path: string } | { error: string } {
    const trimmed = value.trim()
    if (!trimmed) return { error: 'requires a non-empty path' }
    let expanded = trimmed
    if (expanded === '~') {
        expanded = homedir()
    } else if (expanded.startsWith('~/')) {
        expanded = resolve(homedir(), expanded.slice(2))
    }
    const absolute = isAbsolute(expanded) ? expanded : resolve(expanded)
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
        return { error: `path does not exist or is not a directory: ${absolute}` }
    }
    return { path: absolute }
}

/**
 * Parses `--workspace-root <path>` / `--workspace-root=<path>` from the
 * runner's positional args. Returns the resolved absolute path or exits
 * the process with a clear error. Mutates `args` to remove the consumed
 * entries so subcommand dispatch still works.
 */
function extractWorkspaceRootArg(args: string[]): string | undefined {
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        let value: string | undefined
        if (arg === '--workspace-root') {
            const next = args[i + 1]
            if (next === undefined || next.startsWith('--')) {
                console.error('--workspace-root requires a path argument')
                process.exit(1)
            }
            value = next
            args.splice(i, 2)
        } else if (arg?.startsWith('--workspace-root=')) {
            value = arg.slice('--workspace-root='.length)
            args.splice(i, 1)
        }
        if (value === undefined) continue

        const result = normalizeWorkspaceRootInput(value)
        if ('error' in result) {
            console.error(`--workspace-root ${result.error}`)
            process.exit(1)
        }
        return result.path
    }
    return undefined
}

/** Prompts for `--profile` when missing: offers existing enrolled profiles, or free text. Returns undefined if not interactive. */
async function promptForProfile(): Promise<string | undefined> {
    return promptChoiceOrNew('Profile', listEnrolledProfiles(configuration.happyHomeDir))
}

/** Last-known workspace root from a previous run of this profile, if any (e.g. runner self-restarting without re-passing the flag). */
async function resolvePersistedWorkspaceRoot(profileBaseHome: string, profile: string): Promise<string | undefined> {
    try {
        const state = await readRunnerProfileState<RunnerLocallyPersistedState>(resolveRunnerProfilePaths(profileBaseHome, profile))
        return state?.workspaceRoot
    } catch {
        return undefined
    }
}

/** Prompts for `--workspace-root` when missing. Returns undefined if not interactive. */
async function promptForWorkspaceRoot(): Promise<string | undefined> {
    return promptRequired(
        'Workspace root (absolute path the runner may browse/spawn in): ',
        (value) => {
            const result = normalizeWorkspaceRootInput(value)
            return 'error' in result ? { ok: false, error: `Workspace root ${result.error}` } : { ok: true, value: result.path }
        }
    )
}

export const runnerCommand: CommandDefinition = {
    name: 'runner',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        const mutableArgs = [...commandArgs]
        const workspaceRoot = extractWorkspaceRootArg(mutableArgs)
        const runnerSubcommand = mutableArgs[0]

        if (runnerSubcommand === 'enroll') {
            const hub=option(mutableArgs,'--hub'),code=option(mutableArgs,'--code'),profile=option(mutableArgs,'--profile')
            if(!hub||!code||!profile){console.error('Usage: hapi runner enroll --hub <url> --code <code> --profile <name>');process.exitCode=1;return}
            let paths
            try{paths=resolveRunnerProfilePaths(configuration.happyHomeDir,profile)}catch{console.error('Invalid Runner profile name');process.exitCode=1;return}
            if(existsSync(paths.root)){console.error('Runner profile already exists');process.exitCode=1;return}
            const os=platform(),cpu=arch()
            if((os!=='linux'&&os!=='darwin')||(cpu!=='x64'&&cpu!=='arm64')){console.error('Unsupported Runner platform');process.exitCode=1;return}
            try{const machineId=randomUUID();const result=await exchangeRunnerEnrollment(hub,{code,profile,machine:{id:machineId,name:hostname(),platform:os,arch:cpu}});await createRunnerProfile(configuration.happyHomeDir,{version:1,profile,hubUrl:result.hubUrl,organizationId:result.organizationId,runnerId:result.runnerId,machineId},{version:1,credential:result.credential,generation:result.generation});console.log(`Runner profile '${profile}' enrolled`)}catch(error){const code=error instanceof Error?error.message:'enrollment_failed';console.error(`Runner enrollment failed: ${code}`);process.exitCode=1}
            return
        }

        if (runnerSubcommand === 'list') {
            try {
                const sessions = (await profilePost(mutableArgs,'/list')).children as unknown[]??[]

                if (sessions.length === 0) {
                    console.log('No active sessions this runner is aware of (they might have been started by a previous version of the runner)')
                } else {
                    console.log('Active sessions:')
                    console.log(JSON.stringify(sessions, null, 2))
                }
            } catch {
                console.log('No runner running')
            }
            return
        }

        if (runnerSubcommand === 'stop-session') {
            const sessionId = mutableArgs[1]
            if (!sessionId) {
                console.error('Session ID required')
                process.exit(1)
            }

            try {
                const success = Boolean((await profilePost(mutableArgs,'/stop-session',{sessionId})).success)
                console.log(success ? 'Session stopped' : 'Failed to stop session')
            } catch {
                console.log('No runner running')
            }
            return
        }

        if (runnerSubcommand === 'start') {
            let profile=option(mutableArgs,'--profile')
            if(!profile)profile=await promptForProfile()
            if(!profile){console.error('--profile is required');process.exitCode=1;return}
            const profileBaseHome=process.env.HAPI_PROFILE_BASE_HOME??configuration.happyHomeDir
            let resolvedWorkspaceRoot=workspaceRoot
            if(!resolvedWorkspaceRoot)resolvedWorkspaceRoot=await resolvePersistedWorkspaceRoot(profileBaseHome,profile)
            if(!resolvedWorkspaceRoot)resolvedWorkspaceRoot=await promptForWorkspaceRoot()
            if(!resolvedWorkspaceRoot){console.error('--workspace-root is required');process.exitCode=1;return}
            const foreground=mutableArgs.includes('--foreground')
            if (foreground) {
                await startRunner({ workspaceRoot: resolvedWorkspaceRoot, profile })
                process.exit(0)
            }
            const childArgs = ['runner', 'start-sync']
            childArgs.push('--profile',profile)
            childArgs.push('--workspace-root', resolvedWorkspaceRoot)
            const child = spawnHappyCLI(childArgs, {
                detached: true,
                stdio: 'ignore',
                env: { ...process.env, HAPI_HOME: resolveRunnerProfilePaths(profileBaseHome,profile).root, HAPI_PROFILE_BASE_HOME: profileBaseHome }
            })
            child.unref()

            let started = false
            for (let i = 0; i < 50; i++) {
                const state=await readRunnerProfileState<RunnerLocallyPersistedState>(resolveRunnerProfilePaths(profileBaseHome,profile));if(state&&isProcessAlive(state.pid)) {
                    started = true
                    break
                }
                await new Promise(resolve => setTimeout(resolve, 100))
            }

            if (started) {
                console.log('Runner started successfully')
            } else {
                console.error('Failed to start runner')
                process.exit(1)
            }
            process.exit(0)
        }

        if (runnerSubcommand === 'install') {
            let profile=option(mutableArgs,'--profile')
            if(!profile)profile=await promptForProfile()
            if(!profile){console.error('--profile is required');process.exitCode=1;return}
            const paths=resolveRunnerProfilePaths(configuration.happyHomeDir,profile)
            if (!existsSync(paths.profileFile)||!existsSync(paths.credentialFile)){console.error('Runner profile not found. Run `hapi runner enroll --profile '+profile+' ...` first');process.exitCode=1;return}
            let resolvedWorkspaceRoot=workspaceRoot
            if(!resolvedWorkspaceRoot)resolvedWorkspaceRoot=await promptForWorkspaceRoot()
            if(!resolvedWorkspaceRoot){console.error('--workspace-root is required');process.exitCode=1;return}
            const { command: execPath, args: baseArgs } = getHappyCliCommand(['runner','start','--foreground','--profile',profile,'--workspace-root',resolvedWorkspaceRoot])
            if (platform() === 'linux') {
                try { execSync('systemctl --user --version', { stdio: 'ignore' }) } catch { console.error('systemd user instance is not available'); process.exitCode=1; return }
                const unitName=`hapi-runner-${profile}.service`
                const unitDir=join(homedir(),'.config','systemd','user')
                mkdirSync(unitDir,{recursive:true,mode:0o755})
                const execLine = [execPath, ...baseArgs].map((arg) => arg.includes(' ') ? `"${arg}"` : arg).join(' ')
                writeFileSync(join(unitDir,unitName),`[Unit]
Description=HAPI Runner (${profile})
After=network.target

[Service]
Type=simple
ExecStart=${execLine}
Restart=always
RestartSec=5
Environment=HAPI_HOME=${configuration.happyHomeDir}

[Install]
WantedBy=default.target
`)
                try { execSync(`systemctl --user daemon-reload`); execSync(`systemctl --user enable ${unitName}`); execSync(`systemctl --user start ${unitName}`) } catch (error) { console.error('systemctl failed:', error instanceof Error ? error.message : error); process.exitCode=1; return }
                console.log(`Runner profile '${profile}' installed as systemd user service '${unitName}'`)
            } else if (platform() === 'darwin') {
                const label=`com.hapi.runner.${profile}`
                const agentDir=join(homedir(),'Library','LaunchAgents')
                mkdirSync(agentDir,{recursive:true,mode:0o755})
                const argv = [execPath, ...baseArgs].map((arg) => `        <string>${escapeXml(arg)}</string>`).join('\n')
                const homeDir=configuration.happyHomeDir
                const logPath=join(paths.logsDir,'launchd.log')
                writeFileSync(join(agentDir,`${label}.plist`),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
${argv}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HAPI_HOME</key>
        <string>${homeDir}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>
`)
                try { execSync(`launchctl bootstrap gui/${process.getuid?.() ?? executeUid()} "${join(agentDir,`${label}.plist`)}"`) } catch { try { execSync(`launchctl load "${join(agentDir,`${label}.plist`)}"`) } catch { console.error('launchctl failed'); process.exitCode=1; return } }
                console.log(`Runner profile '${profile}' installed as LaunchAgent '${label}'`)
            } else {
                console.error('Service installation is only supported on Linux (systemd) and macOS (launchd)')
                process.exitCode=1
            }
            process.exit(0)
        }

        if (runnerSubcommand === 'uninstall') {
            let profile=option(mutableArgs,'--profile')
            if(!profile)profile=await promptForProfile()
            if(!profile){console.error('--profile is required');process.exitCode=1;return}
            if (platform() === 'linux') {
                const unitName=`hapi-runner-${profile}.service`
                const unitPath=join(homedir(),'.config','systemd','user',unitName)
                try { execSync(`systemctl --user stop ${unitName}`,{stdio:'pipe'}) } catch { /* ignored */ }
                try { execSync(`systemctl --user disable ${unitName}`,{stdio:'pipe'}) } catch { /* ignored */ }
                try { execSync('systemctl --user daemon-reload',{stdio:'pipe'}) } catch { /* ignored */ }
                if (existsSync(unitPath)) unlinkSync(unitPath)
                console.log(`Runner profile '${profile}' uninstalled from systemd`)
            } else if (platform() === 'darwin') {
                const label=`com.hapi.runner.${profile}`
                const plistPath=join(homedir(),'Library','LaunchAgents',`${label}.plist`)
                try { execSync(`launchctl bootout gui/${process.getuid?.() ?? executeUid()}/${label}`,{stdio:'pipe'}) } catch { try { execSync(`launchctl unload "${plistPath}"`,{stdio:'pipe'}) } catch { /* ignored */ } }
                if (existsSync(plistPath)) unlinkSync(plistPath)
                console.log(`Runner profile '${profile}' uninstalled from launchd`)
            } else {
                console.error('Service uninstall is only supported on Linux and macOS')
                process.exitCode=1
            }
            process.exit(0)
        }

        if (runnerSubcommand === 'start-sync') {
            let profile=option(mutableArgs,'--profile')
            if(!profile)profile=await promptForProfile()
            if(!profile)throw new Error('Runner profile is required')
            const profileBaseHome=process.env.HAPI_PROFILE_BASE_HOME??configuration.happyHomeDir
            let resolvedWorkspaceRoot=workspaceRoot
            if(!resolvedWorkspaceRoot)resolvedWorkspaceRoot=await resolvePersistedWorkspaceRoot(profileBaseHome,profile)
            if(!resolvedWorkspaceRoot)resolvedWorkspaceRoot=await promptForWorkspaceRoot()
            if(!resolvedWorkspaceRoot)throw new Error('Runner workspace root is required')
            await startRunner({ workspaceRoot: resolvedWorkspaceRoot, profile })
            process.exit(0)
        }

        if (runnerSubcommand === 'stop') {
            await profilePost(mutableArgs,'/stop').catch(()=>{throw new Error('Runner is not running')})
            process.exit(0)
        }

        if (runnerSubcommand === 'status') {
            const {state}=await profileState(mutableArgs);console.log(state&&isProcessAlive(state.pid)?'Runner is running':'Runner is not running')
            process.exit(0)
        }

        if (runnerSubcommand === 'logs') {
            const {paths}=await profileState(mutableArgs);const latest=readdirSync(paths.logsDir).sort().at(-1)
            if (!latest) {
                console.log('No runner logs found')
            } else {
                console.log(join(paths.logsDir,latest))
            }
            process.exit(0)
        }

        console.log(`
${chalk.bold('hapi runner')} - Runner management

${chalk.bold('Usage:')}
  hapi runner start              Start the runner (detached)
  hapi runner start --foreground Start the runner in foreground (for systemd)
  hapi runner enroll --hub <url> --code <code> --profile <name>
  hapi runner install            Install as OS service (systemd/launchd)
  hapi runner uninstall          Remove OS service installation
  hapi runner stop               Stop the runner (sessions stay alive)
  hapi runner status             Show runner status
  hapi runner list               List active sessions

${chalk.bold('Options:')}
  --profile <name>               Runner profile to use.
  --workspace-root <path>        Directory the runner may browse & spawn in.
                                 Browse & spawn will reject paths outside it.
                                 Supports \`~\` / \`~/foo\` expansion.

  --profile and --workspace-root are required for 'start' and 'install'
  ('uninstall' only needs --profile). If omitted and you're at an
  interactive terminal, you'll be prompted for them.

  If you want to kill all hapi related processes run 
  ${chalk.cyan('hapi doctor clean')}

${chalk.bold('Note:')} The runner runs in the background and manages Claude sessions.

${chalk.bold('To clean up runaway processes:')} Use ${chalk.cyan('hapi doctor clean')}
`)
    }
}

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function executeUid(): string {
    return execSync('id -u', { encoding: 'utf8' }).trim()
}
