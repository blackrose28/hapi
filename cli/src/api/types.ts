import {
    AgentStateSchema,
    AttachmentMetadataSchema,
    CodexCollaborationModeSchema,
    MachineMetadataSchema,
    MachineSchema,
    CliMessagesResponseSchema,
    CreateMachineResponseSchema,
    CreateSessionResponseSchema,
    GetSessionResponseSchema,
    MetadataSchema,
    PermissionModeSchema,
    RunnerStateSchema,
    TodosSchema
} from '@hapi/protocol/schemas'
import {
    LocalHandoffResponseSchema,
    LocalResumeTargetResponseSchema,
    ResumableSessionsResponseSchema
} from '@hapi/protocol/schemas'
import type { CodexCollaborationMode, PermissionMode, Machine, MachineMetadata, RunnerState } from '@hapi/protocol'
import { z } from 'zod'
import { UsageSchema } from '@/claude/types'

export type Usage = z.infer<typeof UsageSchema>

export type {
    AgentState,
    AttachmentMetadata,
    ClaudePermissionMode,
    CodexCollaborationMode,
    CodexPermissionMode,
    Machine,
    MachineMetadata,
    Metadata,
    RunnerState,
    Session,
    CliMessagesResponse,
    CreateMachineResponse,
    CreateSessionResponse,
    GetSessionResponse
} from '@hapi/protocol'
export type SessionPermissionMode = PermissionMode
export type SessionCollaborationMode = CodexCollaborationMode
export type SessionModel = string | null
export type SessionModelReasoningEffort = string | null
export type SessionEffort = string | null

export { CliMessagesResponseSchema, CreateMachineResponseSchema, CreateSessionResponseSchema, AgentStateSchema, AttachmentMetadataSchema, MachineMetadataSchema, MetadataSchema, RunnerStateSchema }


export const GetSessionResponseSchema = CreateSessionResponseSchema
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>

export {
    LocalHandoffResponseSchema,
    LocalResumeTargetResponseSchema,
    ResumableSessionsResponseSchema
}

export const MessageMetaSchema = z.object({
    sentFrom: z.string().optional(),
    fallbackModel: z.string().nullable().optional(),
    customSystemPrompt: z.string().nullable().optional(),
    appendSystemPrompt: z.string().nullable().optional(),
    allowedTools: z.array(z.string()).nullable().optional(),
    disallowedTools: z.array(z.string()).nullable().optional()
})

export type MessageMeta = z.infer<typeof MessageMetaSchema>

export const UserMessageSchema = z.object({
    role: z.literal('user'),
    content: z.object({
        type: z.literal('text'),
        text: z.string(),
        attachments: z.array(AttachmentMetadataSchema).optional()
    }),
    localKey: z.string().optional(),
    meta: MessageMetaSchema.optional()
})

export type UserMessage = z.infer<typeof UserMessageSchema>

export const AgentMessageSchema = z.object({
    role: z.literal('agent'),
    content: z.object({
        type: z.literal('output'),
        data: z.unknown()
    }),
    meta: MessageMetaSchema.optional()
})

export type AgentMessage = z.infer<typeof AgentMessageSchema>

export const MessageContentSchema = z.union([UserMessageSchema, AgentMessageSchema])

export type MessageContent = z.infer<typeof MessageContentSchema>
