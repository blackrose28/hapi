import { parseRemoteAgentCommandOptions } from "./agentCommandOptions";
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
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
            const options = parseRemoteAgentCommandOptions(commandArgs, [] as never[])

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
