import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { configuration } from '@/configuration'
import { readRunnerProfile } from '@/runner/profile'

/** Validate that startup has a usable machine-bound Runner identity. */
export async function authAndSetupMachineIfNeeded(): Promise<void> {
    const profileName = process.env.HAPI_RUNNER_PROFILE?.trim()
    if (!profileName) throw new Error('Runner profile is required. Set HAPI_RUNNER_PROFILE=<name>.')
    await readRunnerProfile(process.env.HAPI_PROFILE_BASE_HOME ?? configuration.happyHomeDir, profileName)
}
