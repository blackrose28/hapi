import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Canonical env var name exported into the wrapped agent / CLI child process so
 * it can self-target its own hub session (REST, shell helpers) without listing
 * `/api/sessions`. See tiann/hapi#1119.
 */
export const HAPI_SESSION_ID_ENV = 'HAPI_SESSION_ID'

/**
 * Publish the hub session id into `process.env` so every downstream agent spawn
 * inherits it. HAPI runs one hub session per CLI process, and every flavor's
 * agent spawn (claude / codex / cursor / opencode today, plus future flavors)
 * derives its child env from `process.env` — so setting it here covers all of
 * them at once, without touching each launcher.
 */
export function exportHapiSessionEnv(sessionId: string): void {
    if (!sessionId) {
        return
    }
    process.env[HAPI_SESSION_ID_ENV] = sessionId
}
