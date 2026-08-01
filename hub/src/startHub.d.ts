export interface HubInstance {
    stop(): Promise<void>
}

export interface StartHubOptions {
    args?: string[]
}

export function startHub(options?: StartHubOptions): Promise<HubInstance>
