import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import {
    CLAUDE_MODEL_PRESETS,
    getClaudeModelLabel,
    isKnownFlavor,
    type AgentModelCatalogResult
} from '@hapi/protocol'
import { listAgentModels } from '../agentModels/catalog'

type ListAgentModelsRequest = {
    agent?: unknown
    cwd?: unknown
}

function claudeFailureResult(): AgentModelCatalogResult {
    return {
        status: 'failed',
        models: CLAUDE_MODEL_PRESETS.map((id) => ({
            id,
            displayName: getClaudeModelLabel(id) ?? id
        })),
        source: 'static',
        error: 'Claude model discovery failed'
    }
}

export function registerAgentModelHandlers(
    rpcHandlerManager: RpcHandlerManager,
    workingDirectory: string
): void {
    rpcHandlerManager.registerHandler<ListAgentModelsRequest, AgentModelCatalogResult>(
        'listAgentModels',
        async (data) => {
            const agent = typeof data?.agent === 'string' ? data.agent : null
            if (!isKnownFlavor(agent)) {
                return {
                    status: 'unsupported',
                    models: [],
                    source: 'static'
                }
            }

            try {
                const requestedCwd = typeof data.cwd === 'string' && data.cwd.trim()
                    ? data.cwd.trim()
                    : workingDirectory
                return await listAgentModels(agent, { cwd: requestedCwd })
            } catch {
                return agent === 'claude'
                    ? claudeFailureResult()
                    : {
                        status: 'unsupported',
                        models: [],
                        source: 'static'
                    }
            }
        }
    )
}
