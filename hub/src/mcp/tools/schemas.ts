import { z } from 'zod'

// All tools that target a specific session must include sessionId.
// No tool may rely on an implicit "current session" - callers must
// always provide the identifier explicitly.

export const sessionIdSchema = z.object({
    sessionId: z.string().min(1).describe('The session to target. Must be explicitly provided - no implicit current session exists on the hub MCP endpoint.')
})

export type SessionIdInput = z.infer<typeof sessionIdSchema>

export const changeTitleInputSchema = sessionIdSchema.extend({
    title: z.string().min(1).max(255).describe('The new title for the chat session')
})

export type ChangeTitleInput = z.infer<typeof changeTitleInputSchema>

export const getSessionInputSchema = sessionIdSchema
export type GetSessionInput = SessionIdInput

export const listSessionsInputSchema = z.object({})
export type ListSessionsInput = z.infer<typeof listSessionsInputSchema>

// Explicit JSON Schema definitions for MCP protocol (avoids Zod internals dependency)
export const changeTitleJsonSchema = {
    type: 'object' as const,
    properties: {
        sessionId: { type: 'string' as const, description: 'The session to target. Must be explicitly provided.' },
        title: { type: 'string' as const, description: 'The new title for the chat session' }
    },
    required: ['sessionId', 'title']
}

export const getSessionJsonSchema = {
    type: 'object' as const,
    properties: {
        sessionId: { type: 'string' as const, description: 'The session to target. Must be explicitly provided.' }
    },
    required: ['sessionId']
}

export const listSessionsJsonSchema = {
    type: 'object' as const,
    properties: {} as Record<string, unknown>,
    required: [] as string[]
}
