import { z } from 'zod'
import { toSessionSummary } from '@hapi/protocol'
import {
    changeTitleInputSchema, type ChangeTitleInput,
    getSessionInputSchema, type GetSessionInput,
    listSessionsInputSchema, type ListSessionsInput,
    sessionIdSchema, type SessionIdInput,
    changeTitleJsonSchema, getSessionJsonSchema, listSessionsJsonSchema,
    sendMessageInputSchema, type SendMessageInput,
    getMessagesAfterInputSchema, type GetMessagesAfterInput,
    sendMessageJsonSchema, getMessagesAfterJsonSchema
} from './schemas'
import { resolveToolContext, requireSessionForTool } from './contextGuards'
import type { Context } from 'hono'
import type { WebAppEnv } from '../../web/middleware/auth'
import type { SyncEngine } from '../../sync/syncEngine'

// ---- Result types ----

export type McpToolResult = {
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
}

/** Protocol-level JSON-RPC error returned by a tool handler.
 *  The server layer translates this into a proper JSON-RPC error response. */
export type McpToolError = {
    __mcpError: true
    code: number
    message: string
}

/** Union: tool handlers return either a tool result or a protocol error. */
export type McpToolOutput = McpToolResult | McpToolError

// ---- JSON-RPC error codes ----

/** Invalid tool params (missing sessionId, bad type, etc.) */
export const INVALID_PARAMS = -32602
/** Session not found */
export const SESSION_NOT_FOUND = -32001
/** Session access denied (cross-namespace, unauthorized) */
export const ACCESS_DENIED = -32002
/** Hub service unavailable (engine down) */
export const SERVICE_UNAVAILABLE = -32003

// ---- Helpers ----

function textResult(text: string, isError = false): McpToolResult {
    return { content: [{ type: 'text' as const, text }], isError }
}

function mcpError(code: number, message: string): McpToolError {
    return { __mcpError: true, code, message }
}

export function isMcpToolError(output: McpToolOutput): output is McpToolError {
    return '__mcpError' in output && (output as McpToolError).__mcpError === true
}

// ---- Tool definition type ----

export type McpToolDefinition = {
    name: string
    description: string
    title: string
    inputSchema: z.ZodTypeAny
    jsonSchema: Record<string, unknown>
    handler: (c: Context<WebAppEnv>, getSyncEngine: () => SyncEngine | null) => (args: Record<string, unknown>) => Promise<McpToolOutput>
}

// ---- Tool definitions ----

export const changeTitleTool: McpToolDefinition = {
    name: 'change_title',
    title: 'Change Chat Title',
    description: 'Change the title of a chat session. Requires an explicit sessionId - there is no implicit current session.',
    inputSchema: changeTitleInputSchema,
    jsonSchema: changeTitleJsonSchema,
    handler: (c, getSyncEngine) => async (args) => {
        const ctx = resolveToolContext(c, getSyncEngine)
        if (ctx instanceof Response) {
            return mcpError(SERVICE_UNAVAILABLE, 'Service unavailable')
        }
        const parsed = changeTitleInputSchema.safeParse(args)
        if (!parsed.success) {
            return mcpError(INVALID_PARAMS, `Invalid params: ${parsed.error.message}`)
        }
        const { sessionId, title } = parsed.data as ChangeTitleInput
        const sessionResult = requireSessionForTool(c, ctx.engine, sessionId, ctx.namespace)
        if (sessionResult instanceof Response) {
            return sessionResponseToError(sessionResult)
        }
        try {
            await ctx.engine.renameSession(sessionResult.sessionId, title)
            return textResult(`Successfully changed session title to "${title}"`)
        } catch (error) {
            return textResult(`Failed to change title: ${error instanceof Error ? error.message : String(error)}`, true)
        }
    }
}

export const listSessionsTool: McpToolDefinition = {
    name: 'list_sessions',
    title: 'List Sessions',
    description: 'List all sessions in the caller\'s namespace. Does not require a sessionId.',
    inputSchema: listSessionsInputSchema,
    jsonSchema: listSessionsJsonSchema,
    handler: (c, getSyncEngine) => async (_args) => {
        const ctx = resolveToolContext(c, getSyncEngine)
        if (ctx instanceof Response) {
            return mcpError(SERVICE_UNAVAILABLE, 'Service unavailable')
        }
        const sessions = ctx.engine.getSessionsByNamespace(ctx.namespace)
            .sort((a, b) => {
                if (a.active !== b.active) return a.active ? -1 : 1
                return b.updatedAt - a.updatedAt
            })
            .map(toSessionSummary)
        return textResult(JSON.stringify(sessions, null, 2))
    }
}

export const getSessionTool: McpToolDefinition = {
    name: 'get_session',
    title: 'Get Session',
    description: 'Get details for a specific session. Requires an explicit sessionId - there is no implicit current session.',
    inputSchema: getSessionInputSchema,
    jsonSchema: getSessionJsonSchema,
    handler: (c, getSyncEngine) => async (args) => {
        const ctx = resolveToolContext(c, getSyncEngine)
        if (ctx instanceof Response) {
            return mcpError(SERVICE_UNAVAILABLE, 'Service unavailable')
        }
        const parsed = sessionIdSchema.safeParse(args)
        if (!parsed.success) {
            return mcpError(INVALID_PARAMS, 'Invalid params: sessionId is required')
        }
        const { sessionId } = parsed.data as SessionIdInput
        const sessionResult = requireSessionForTool(c, ctx.engine, sessionId, ctx.namespace)
        if (sessionResult instanceof Response) {
            return sessionResponseToError(sessionResult)
        }
        return textResult(JSON.stringify(toSessionSummary(sessionResult.session), null, 2))
    }
}

export const sendMessageTool: McpToolDefinition = {
    name: 'send_message',
    title: 'Send Message',
    description: 'Send a user message into a session and wait for the agent response. Requires an explicit sessionId and the session must be active.',
    inputSchema: sendMessageInputSchema,
    jsonSchema: sendMessageJsonSchema,
    handler: (c, getSyncEngine) => async (args) => {
        const ctx = resolveToolContext(c, getSyncEngine)
        if (ctx instanceof Response) {
            return mcpError(SERVICE_UNAVAILABLE, 'Service unavailable')
        }
        const parsed = sendMessageInputSchema.safeParse(args)
        if (!parsed.success) {
            return mcpError(INVALID_PARAMS, `Invalid params: ${parsed.error.message}`)
        }
        const { sessionId, text, localId, attachments } = parsed.data as SendMessageInput
        const sessionResult = requireSessionForTool(c, ctx.engine, sessionId, ctx.namespace, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResponseToError(sessionResult)
        }
        try {
            await ctx.engine.sendMessage(sessionResult.sessionId, { text, localId, attachments })
            return textResult(`Message sent successfully to session ${sessionResult.sessionId}`)
        } catch (error) {
            return textResult(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`, true)
        }
    }
}

export const getMessagesAfterTool: McpToolDefinition = {
    name: 'get_messages_after',
    title: 'Get Messages After',
    description: 'Poll for messages after a given sequence number. Returns messages with seq > afterSeq in deterministic order. Requires an explicit sessionId.',
    inputSchema: getMessagesAfterInputSchema,
    jsonSchema: getMessagesAfterJsonSchema,
    handler: (c, getSyncEngine) => async (args) => {
        const ctx = resolveToolContext(c, getSyncEngine)
        if (ctx instanceof Response) {
            return mcpError(SERVICE_UNAVAILABLE, 'Service unavailable')
        }
        const parsed = getMessagesAfterInputSchema.safeParse(args)
        if (!parsed.success) {
            return mcpError(INVALID_PARAMS, `Invalid params: ${parsed.error.message}`)
        }
        const { sessionId, afterSeq, limit = 200 } = parsed.data as GetMessagesAfterInput
        const sessionResult = requireSessionForTool(c, ctx.engine, sessionId, ctx.namespace)
        if (sessionResult instanceof Response) {
            return sessionResponseToError(sessionResult)
        }
        try {
            const messages = ctx.engine.getMessagesAfter(sessionResult.sessionId, { afterSeq, limit })
            return textResult(JSON.stringify(messages, null, 2))
        } catch (error) {
            return textResult(`Failed to get messages: ${error instanceof Error ? error.message : String(error)}`, true)
        }
    }
}

/** All hub MCP tools. */
export const hubMcpTools: McpToolDefinition[] = [
    changeTitleTool,
    listSessionsTool,
    getSessionTool,
    sendMessageTool,
    getMessagesAfterTool,
]

// ---- Internal helpers ----

async function sessionResponseToError(response: Response): Promise<McpToolError> {
    let reason = 'unknown'
    let status = 500
    try {
        const json = await response.json() as { error?: string }
        reason = json.error ?? 'unknown'
        status = response.status
    } catch {
        status = response.status
    }
    // Map HTTP status to JSON-RPC error code
    if (status === 403) return mcpError(ACCESS_DENIED, reason)
    if (status === 404) return mcpError(SESSION_NOT_FOUND, reason)
    if (status === 409) return mcpError(INVALID_PARAMS, reason)
    return mcpError(SERVICE_UNAVAILABLE, reason)
}
