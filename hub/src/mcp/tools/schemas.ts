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

export const sendMessageInputSchema = sessionIdSchema.extend({
    text: z.string().min(1).describe('The user message text to send into the session.'),
    localId: z.string().optional().describe('Optional client-generated local ID for the message.'),
    attachments: z.array(z.object({
        id: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        size: z.number(),
        path: z.string(),
        previewUrl: z.string().optional()
    })).optional().describe('Optional file attachments.')
})

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>

export const getMessagesAfterInputSchema = sessionIdSchema.extend({
    afterSeq: z.number().int().min(0).describe('Return messages with seq strictly greater than this value. Use 0 to get all messages.'),
    limit: z.number().int().min(1).max(200).optional().describe('Maximum number of messages to return. Defaults to 200.')
})

export type GetMessagesAfterInput = z.infer<typeof getMessagesAfterInputSchema>

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

export const sendMessageJsonSchema = {
    type: 'object' as const,
    properties: {
        sessionId: { type: 'string' as const, description: 'The session to target. Must be explicitly provided.' },
        text: { type: 'string' as const, description: 'The user message text to send into the session.' },
        localId: { type: 'string' as const, description: 'Optional client-generated local ID for the message.' },
        attachments: {
            type: 'array' as const,
            items: {
                type: 'object' as const,
                properties: {
                    id: { type: 'string' as const },
                    filename: { type: 'string' as const },
                    mimeType: { type: 'string' as const },
                    size: { type: 'number' as const },
                    path: { type: 'string' as const },
                    previewUrl: { type: 'string' as const }
                },
                required: ['id', 'filename', 'mimeType', 'size', 'path']
            },
            description: 'Optional file attachments.'
        }
    },
    required: ['sessionId', 'text']
}

export const getMessagesAfterJsonSchema = {
    type: 'object' as const,
    properties: {
        sessionId: { type: 'string' as const, description: 'The session to target. Must be explicitly provided.' },
        afterSeq: { type: 'number' as const, description: 'Return messages with seq strictly greater than this value. Use 0 to get all messages.' },
        limit: { type: 'number' as const, description: 'Maximum number of messages to return. Defaults to 200.' }
    },
    required: ['sessionId', 'afterSeq']
}
