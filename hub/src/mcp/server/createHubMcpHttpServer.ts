/**
 * Hub MCP Streamable HTTP server.
 *
 * Implements the MCP Streamable HTTP transport protocol
 * (JSON-RPC 2.0 over HTTP POST) without external dependencies.
 *
 * Protocol spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
 *
 * - POST /api/mcp - client sends JSON-RPC request, gets JSON-RPC response
 * - Supports initialize, tools/list, tools/call methods
 * - Stateless: no session affinity, no SSE streams (synchronous only)
 */

import { hubMcpTools, isMcpToolError, type McpToolDefinition, type McpToolOutput, INVALID_PARAMS } from '../tools/index'
import type { Context } from 'hono'
import type { WebAppEnv } from '../../web/middleware/auth'
import type { SyncEngine } from '../../sync/syncEngine'

// ---- JSON-RPC types ----

type JsonRpcRequest = {
    jsonrpc: '2.0'
    id?: string | number | null
    method: string
    params?: Record<string, unknown>
}

type JsonRpcResponse = {
    jsonrpc: '2.0'
    id: string | number | null
    result?: unknown
    error?: {
        code: number
        message: string
        data?: unknown
    }
}

const SERVER_INFO = {
    name: 'HAPI Hub MCP',
    version: '1.0.0'
}

const PROTOCOL_VERSION = '2025-03-26'

// ---- Tool map (built once) ----

const toolMap = new Map(hubMcpTools.map(t => [t.name, t]))

// ---- Protocol handlers ----

function handleInitialize(_params: Record<string, unknown> | undefined): unknown {
    return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
            tools: { listChanged: false }
        },
        serverInfo: SERVER_INFO
    }
}

function handleToolsList(): unknown {
    return {
        tools: hubMcpTools.map(toolDefToJson)
    }
}

async function handleToolsCall(
    params: Record<string, unknown> | undefined,
    c: Context<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null,
    id: string | number | null
): Promise<JsonRpcResponse> {
    if (!params) {
        return jsonRpcError(id, INVALID_PARAMS, 'Invalid params: missing params')
    }

    const toolName = params.name as string | undefined
    if (!toolName) {
        return jsonRpcError(id, INVALID_PARAMS, 'Invalid params: missing tool name')
    }

    const tool = toolMap.get(toolName)
    if (!tool) {
        return jsonRpcError(id, INVALID_PARAMS, `Invalid params: unknown tool "${toolName}"`)
    }

    const args = (params.arguments as Record<string, unknown>) ?? {}
    const handler = tool.handler(c, getSyncEngine)
    const output: McpToolOutput = await handler(args)

    if (isMcpToolError(output)) {
        return jsonRpcError(id, output.code, output.message)
    }

    return { jsonrpc: '2.0', id, result: output }
}

/** Handle a single JSON-RPC request. */
export async function handleMcpRequest(
    body: JsonRpcRequest,
    c: Context<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): Promise<JsonRpcResponse> {
    const { id = null, method, params } = body

    try {
        switch (method) {
            case 'initialize':
                return { jsonrpc: '2.0', id, result: handleInitialize(params) }
            case 'notifications/initialized':
                return { jsonrpc: '2.0', id, result: {} }
            case 'tools/list':
                return { jsonrpc: '2.0', id, result: handleToolsList() }
            case 'tools/call':
                return await handleToolsCall(params, c, getSyncEngine, id)
            default:
                return jsonRpcError(id, -32601, `Method not found: ${method}`)
        }
    } catch (error) {
        return jsonRpcError(id, -32603, 'Internal error', error instanceof Error ? error.message : String(error))
    }
}

// ---- Helpers ----

function jsonRpcError(id: string | number | null, code: number, message: string, _data?: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolDefToJson(tool: McpToolDefinition): unknown {
    return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.jsonSchema
    }
}
