import chalk from 'chalk'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { initializeToken } from '@/ui/tokenInit'
import { maybeAutoStartServer } from '@/utils/autoStartServer'
import type { CommandDefinition } from './types'

export const piCommand: CommandDefinition = {
    name: 'pi',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            // Pi RPC mode has no runtime permission switching (always
            // auto-approve) and no local terminal/TUI mode, so --permission-mode
            // and --yolo are intentionally not parsed here — the runner never
            // sends them for pi (see runner/run.ts#buildCliArgs).
            const options: {
                startedBy?: 'runner' | 'terminal'
                startingMode?: 'local' | 'remote'
                model?: string
                effort?: string
                resumeSessionId?: string
            } = {}

            for (let i = 0; i < commandArgs.length; i++) {
                const arg = commandArgs[i]
                if (arg === '--started-by') {
                    options.startedBy = commandArgs[++i] as 'runner' | 'terminal'
                } else if (arg === '--hapi-starting-mode') {
                    const value = commandArgs[++i]
                    if (value === 'local' || value === 'remote') {
                        options.startingMode = value
                    } else {
                        throw new Error('Invalid --hapi-starting-mode (expected local or remote)')
                    }
                } else if (arg === '--resume' || arg === '--session-id') {
                    // Pi uses --session-id for exact session resume (RPC mode);
                    // --resume is accepted as an alias for consistency with other flavors.
                    const sessionId = commandArgs[++i]
                    if (!sessionId) {
                        throw new Error(`Missing ${arg} value`)
                    }
                    options.resumeSessionId = sessionId
                } else if (arg === '--model') {
                    const model = commandArgs[++i]
                    if (!model) {
                        throw new Error('Missing --model value')
                    }
                    options.model = model
                } else if (arg === '--effort') {
                    const effort = commandArgs[++i]
                    if (!effort) {
                        throw new Error('Missing --effort value')
                    }
                    options.effort = effort
                }
            }

            await initializeToken()
            await maybeAutoStartServer()
            await authAndSetupMachineIfNeeded()

            const { runPi } = await import('@/pi/runPi')
            await runPi(options)
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
