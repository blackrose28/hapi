import {
    CLAUDE_MODEL_PRESETS,
    getClaudeModelLabel,
    type AgentFlavor,
    type AgentModelCatalogResult,
    type AgentModelDescriptor
} from '@hapi/protocol'
import axios from 'axios'
import {
    discoverClaudeGatewayModels,
    type AgentModelHttpGet
} from './claudeGateway'
import {
    filterModelsByAvailableModels,
    resolveClaudeAvailableModels
} from './claudePolicy'

export type AgentModelCatalogContext = {
    cwd: string
    env?: Record<string, string | undefined>
    httpGet?: AgentModelHttpGet
    managedSettingsPaths?: string[]
}

function claudeFallbackModels(): AgentModelDescriptor[] {
    return CLAUDE_MODEL_PRESETS.map((id) => ({
        id,
        displayName: getClaudeModelLabel(id) ?? id
    }))
}

function withFallback(
    agent: AgentFlavor,
    result: AgentModelCatalogResult,
    availableModels: string[] | null
): AgentModelCatalogResult {
    if (result.models.length > 0 || agent !== 'claude' || result.status === 'dynamic') {
        return result
    }

    return {
        ...result,
        models: filterModelsByAvailableModels(claudeFallbackModels(), availableModels)
    }
}

type CatalogAdapter = (
    context: Required<Pick<AgentModelCatalogContext, 'cwd' | 'httpGet'>> & {
        env: Record<string, string | undefined>
        availableModels: string[] | null
    }
) => Promise<AgentModelCatalogResult>

const CATALOG_ADAPTERS: Partial<Record<AgentFlavor, CatalogAdapter>> = {
    claude: async (context) => await discoverClaudeGatewayModels(context)
}

export async function listAgentModels(
    agent: AgentFlavor,
    context: AgentModelCatalogContext
): Promise<AgentModelCatalogResult> {
    const adapter = CATALOG_ADAPTERS[agent]
    if (!adapter) {
        return {
            status: 'unsupported',
            models: [],
            source: 'static'
        }
    }

    const env = context.env ?? process.env
    const policy = await resolveClaudeAvailableModels({
        cwd: context.cwd,
        env,
        managedSettingsPaths: context.managedSettingsPaths
    })
    if (policy.blocked) {
        return {
            status: 'unsupported',
            models: [],
            source: 'claude-gateway'
        }
    }

    const result = await adapter({
        cwd: context.cwd,
        env,
        httpGet: context.httpGet ?? ((url, config) => axios.get(url, config)),
        availableModels: policy.availableModels
    })

    return withFallback(agent, result, policy.availableModels)
}
