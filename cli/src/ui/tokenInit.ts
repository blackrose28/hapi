import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { configuration } from '@/configuration'
import { readRunnerProfile } from '@/runner/profile'

/** Resolve the explicitly selected enrolled Runner profile before agent startup. */
export async function initializeToken(): Promise<void> {
    const profileName = process.env.HAPI_RUNNER_PROFILE?.trim()
    if (!profileName) {
        throw new Error('Runner enrollment required. Enroll with `hapi runner enroll`, then set HAPI_RUNNER_PROFILE=<name>.')
    }
    const enrolled = await readRunnerProfile(
        process.env.HAPI_PROFILE_BASE_HOME ?? configuration.happyHomeDir,
        profileName
    ).catch(() => {
        throw new Error(`Runner profile '${profileName}' is unavailable. Re-enroll it with \`hapi runner enroll --profile ${profileName}\`.`)
    })
    configuration._setApiUrl(enrolled.profile.hubUrl)
}
