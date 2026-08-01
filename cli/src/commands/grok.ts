import chalk from 'chalk'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { initializeToken } from '@/ui/tokenInit'
import { maybeAutoStartServer } from '@/utils/autoStartServer'
import type { CommandDefinition } from './types'
import { GROK_PERMISSION_MODES } from '@hapi/protocol/modes'
import type { GrokPermissionMode } from '@hapi/protocol/types'

export const grokCommand: CommandDefinition = {
    name: 'grok',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        try {
            const options: {
                startedBy?: 'runner' | 'terminal'
                startingMode?: 'local' | 'remote'
                permissionMode?: GrokPermissionMode
                model?: string
                effort?: string
                resumeSessionId?: string
            } = {}

            let hasExplicitPermissionMode = false

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
                } else if (arg === '--permission-mode') {
                    const mode = commandArgs[++i]
                    if (!mode || !(GROK_PERMISSION_MODES as readonly string[]).includes(mode)) {
                        throw new Error(`Invalid --permission-mode value: ${mode ?? '(missing)'}`)
                    }
                    options.permissionMode = mode as GrokPermissionMode
                    hasExplicitPermissionMode = true
                } else if (arg === '--yolo' && !hasExplicitPermissionMode) {
                    options.permissionMode = 'bypassPermissions'
                } else if (arg === '--resume') {
                    const sessionId = commandArgs[++i]
                    if (!sessionId) {
                        throw new Error('Missing --resume value')
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

            const { runGrok } = await import('@/grok/runGrok')
            await runGrok(options)
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
