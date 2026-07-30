import { z } from 'zod'

export const TERMINAL_SNIPPET_NAME_MAX_LENGTH = 80
export const TERMINAL_SNIPPET_COMMAND_MAX_LENGTH = 8192
export const TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH = 240
export const TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE = 200

export const TerminalSnippetSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(TERMINAL_SNIPPET_NAME_MAX_LENGTH),
    command: z.string().min(1).max(TERMINAL_SNIPPET_COMMAND_MAX_LENGTH),
    description: z.string().max(TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH).nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
})

const TerminalSnippetInputSchema = z.object({
    name: z.string()
        .trim()
        .min(1)
        .max(TERMINAL_SNIPPET_NAME_MAX_LENGTH),
    command: z.string()
        .max(TERMINAL_SNIPPET_COMMAND_MAX_LENGTH)
        .refine(command => command.trim().length > 0),
    description: z.string()
        .trim()
        .max(TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH)
        .nullable()
        .optional()
        .transform(description => description || null)
})

export const CreateTerminalSnippetInputSchema = TerminalSnippetInputSchema
export const UpdateTerminalSnippetInputSchema = TerminalSnippetInputSchema

export const TerminalSnippetsResponseSchema = z.object({
    snippets: z.array(TerminalSnippetSchema)
        .max(TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE)
})

export const TerminalSnippetResponseSchema = z.object({
    snippet: TerminalSnippetSchema
})

export type TerminalSnippet = z.infer<typeof TerminalSnippetSchema>
export type CreateTerminalSnippetInput = z.input<typeof CreateTerminalSnippetInputSchema>
export type UpdateTerminalSnippetInput = z.input<typeof UpdateTerminalSnippetInputSchema>
export type TerminalSnippetsResponse = z.infer<typeof TerminalSnippetsResponseSchema>
export type TerminalSnippetResponse = z.infer<typeof TerminalSnippetResponseSchema>
