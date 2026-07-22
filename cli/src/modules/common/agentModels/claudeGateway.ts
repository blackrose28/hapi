import type { AgentModelCatalogResult } from '@hapi/protocol'
import { filterModelsByAvailableModels } from './claudePolicy'

export type AgentModelHttpResponse = {
    status: number
    data: unknown
}

export type AgentModelHttpGet = (
    url: string,
    config: Record<string, unknown>
) => Promise<AgentModelHttpResponse>

export type ClaudeGatewayContext = {
    cwd: string
    env: Record<string, string | undefined>
    httpGet: AgentModelHttpGet
    availableModels: string[] | null
}

const BLOCKED_CUSTOM_HEADERS = new Set([
    'authorization',
    'x-api-key',
    'anthropic-version',
    'host',
    'content-length'
])

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function isEnabled(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true'
}

function hasSelectedCloudProvider(env: Record<string, string | undefined>): boolean {
    return Object.entries(env).some(([name, value]) => (
        name.startsWith('CLAUDE_CODE_USE_') && isEnabled(value)
    ))
}

function hasSupportedGateway(env: Record<string, string | undefined>): boolean {
    const rawBaseUrl = env.ANTHROPIC_BASE_URL?.trim()
    if (!rawBaseUrl) {
        return false
    }

    try {
        const url = new URL(rawBaseUrl)
        return (url.protocol === 'http:' || url.protocol === 'https:')
            && url.hostname.toLowerCase() !== 'api.anthropic.com'
            && !url.username
            && !url.password
    } catch {
        return false
    }
}

function canDiscoverClaudeGatewayModels(env: Record<string, string | undefined>): boolean {
    return env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY === '1'
        && env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC !== '1'
        && !hasSelectedCloudProvider(env)
        && hasSupportedGateway(env)
        && Boolean(env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim())
}

function parseCustomHeaders(value: string | undefined): Record<string, string> {
    if (!value) {
        return {}
    }

    const headers: Record<string, string> = {}
    for (const line of value.split('\n')) {
        const separator = line.indexOf(':')
        if (separator <= 0) {
            continue
        }

        const rawName = line.slice(0, separator)
        const rawHeaderValue = line.slice(separator + 1)
        if (CONTROL_CHARACTER_PATTERN.test(rawName) || CONTROL_CHARACTER_PATTERN.test(rawHeaderValue)) {
            continue
        }

        const name = rawName.trim()
        const headerValue = rawHeaderValue.trim()
        if (
            !name
            || !headerValue
            || !HEADER_NAME_PATTERN.test(name)
            || BLOCKED_CUSTOM_HEADERS.has(name.toLowerCase())
        ) {
            continue
        }

        headers[name] = headerValue
    }
    return headers
}

function buildGatewayRequest(baseUrl: string): { endpoint: string; source: string } {
    const url = new URL(baseUrl)
    const basePath = url.pathname.replace(/\/+$/, '')
    url.pathname = basePath.endsWith('/v1')
        ? `${basePath}/models`
        : `${basePath}/v1/models`
    url.search = ''
    url.hash = ''
    url.searchParams.set('limit', '1000')

    return {
        endpoint: url.toString(),
        source: `gateway:${url.host}${basePath}`
    }
}

function asNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null
}

function normalizeModels(payload: unknown): AgentModelCatalogResult['models'] | null {
    if (!payload || typeof payload !== 'object') {
        return null
    }

    const data = (payload as { data?: unknown }).data
    if (!Array.isArray(data)) {
        return null
    }

    const seen = new Set<string>()
    const models: AgentModelCatalogResult['models'] = []
    for (const entry of data) {
        if (!entry || typeof entry !== 'object') {
            continue
        }

        const record = entry as Record<string, unknown>
        const id = asNonEmptyString(record.id)
        if (
            !id
            || seen.has(id)
            || (!id.startsWith('claude') && !id.startsWith('anthropic'))
        ) {
            continue
        }

        seen.add(id)
        models.push({
            id,
            displayName: asNonEmptyString(record.display_name)
                ?? asNonEmptyString(record.displayName)
                ?? id
        })
    }

    return models
}

function failedResult(source: string): AgentModelCatalogResult {
    return {
        status: 'failed',
        models: [],
        source,
        error: 'Claude model discovery failed'
    }
}

export async function discoverClaudeGatewayModels(
    context: ClaudeGatewayContext
): Promise<AgentModelCatalogResult> {
    if (!canDiscoverClaudeGatewayModels(context.env)) {
        return {
            status: 'unsupported',
            models: [],
            source: 'claude-gateway'
        }
    }

    const baseUrl = context.env.ANTHROPIC_BASE_URL!.trim()
    const request = buildGatewayRequest(baseUrl)
    const headers: Record<string, string> = {
        'anthropic-version': '2023-06-01',
        ...parseCustomHeaders(context.env.ANTHROPIC_CUSTOM_HEADERS)
    }

    const authToken = context.env.ANTHROPIC_AUTH_TOKEN?.trim()
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`
    } else {
        headers['x-api-key'] = context.env.ANTHROPIC_API_KEY!.trim()
    }

    try {
        const response = await context.httpGet(request.endpoint, {
            timeout: 3_000,
            maxRedirects: 0,
            validateStatus: () => true,
            headers
        })

        if (response.status < 200 || response.status >= 300) {
            return failedResult(request.source)
        }

        const normalizedModels = normalizeModels(response.data)
        if (!normalizedModels || normalizedModels.length === 0) {
            return failedResult(request.source)
        }

        const models = filterModelsByAvailableModels(
            normalizedModels,
            context.availableModels
        )

        return {
            status: 'dynamic',
            models,
            source: request.source
        }
    } catch {
        return failedResult(request.source)
    }
}
