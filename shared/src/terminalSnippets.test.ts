import { describe, expect, it } from 'bun:test'
import { SyncEventSchema } from './schemas'
import {
    CreateTerminalSnippetInputSchema,
    TERMINAL_SNIPPET_COMMAND_MAX_LENGTH,
    TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH,
    TERMINAL_SNIPPET_NAME_MAX_LENGTH,
    TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE,
    TerminalSnippetSchema,
    TerminalSnippetsResponseSchema,
    UpdateTerminalSnippetInputSchema
} from './terminalSnippets'
import type {
    CreateTerminalSnippetInput,
    UpdateTerminalSnippetInput
} from './terminalSnippets'

const validSnippet = {
    id: 'snippet-1',
    name: 'List files',
    command: 'ls -la',
    description: null,
    createdAt: 1,
    updatedAt: 2
}

it('types description as optional and normalizes its omission', () => {
    const createInput: CreateTerminalSnippetInput = {
        name: 'Status',
        command: 'git status'
    }
    const updateInput: UpdateTerminalSnippetInput = {
        name: 'Status',
        command: 'git status'
    }

    expect(CreateTerminalSnippetInputSchema.parse(createInput)).toEqual({
        ...createInput,
        description: null
    })
    expect(UpdateTerminalSnippetInputSchema.parse(updateInput)).toEqual({
        ...updateInput,
        description: null
    })
})

describe.each([
    ['create', CreateTerminalSnippetInputSchema],
    ['update', UpdateTerminalSnippetInputSchema]
] as const)('%s terminal snippet input', (_name, schema) => {
    it('trims the name and description while preserving a multiline command', () => {
        const command = 'printf "first line\\n"\n  printf "second line\\n"  '

        expect(schema.parse({
            name: '  Deploy preview  ',
            command,
            description: '  Runs the preview deployment  '
        })).toEqual({
            name: 'Deploy preview',
            command,
            description: 'Runs the preview deployment'
        })
    })

    it('normalizes omitted or empty descriptions to null', () => {
        expect(schema.parse({
            name: 'Without description',
            command: 'pwd'
        }).description).toBeNull()

        expect(schema.parse({
            name: 'Empty description',
            command: 'pwd',
            description: ''
        }).description).toBeNull()
    })

    it('accepts fields at their exact maximum lengths', () => {
        const input = {
            name: 'n'.repeat(TERMINAL_SNIPPET_NAME_MAX_LENGTH),
            command: 'c'.repeat(TERMINAL_SNIPPET_COMMAND_MAX_LENGTH),
            description: 'd'.repeat(TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH)
        }

        expect(schema.parse(input)).toEqual(input)
    })

    it('strips server-owned fields from client input', () => {
        expect(schema.parse({
            id: 'client-controlled-id',
            name: 'Safe input',
            command: 'pwd',
            description: null,
            createdAt: 100,
            updatedAt: 200
        })).toEqual({
            name: 'Safe input',
            command: 'pwd',
            description: null
        })
    })

    it('rejects empty or oversized user input', () => {
        const base = { name: 'Valid', command: 'pwd' }

        expect(() => schema.parse({ ...base, name: '' })).toThrow()
        expect(() => schema.parse({ ...base, name: '   ' })).toThrow()
        expect(() => schema.parse({ ...base, command: '' })).toThrow()
        expect(() => schema.parse({ ...base, command: ' \n\t ' })).toThrow()
        expect(() => schema.parse({
            ...base,
            name: 'n'.repeat(TERMINAL_SNIPPET_NAME_MAX_LENGTH + 1)
        })).toThrow()
        expect(() => schema.parse({
            ...base,
            command: 'c'.repeat(TERMINAL_SNIPPET_COMMAND_MAX_LENGTH + 1)
        })).toThrow()
        expect(() => schema.parse({
            ...base,
            description: 'd'.repeat(TERMINAL_SNIPPET_DESCRIPTION_MAX_LENGTH + 1)
        })).toThrow()
    })
})

describe('TerminalSnippetSchema', () => {
    it('validates server-owned identifiers and timestamps', () => {
        expect(TerminalSnippetSchema.parse(validSnippet)).toEqual(validSnippet)
        expect(() => TerminalSnippetSchema.parse({ ...validSnippet, id: '' })).toThrow()
        expect(() => TerminalSnippetSchema.parse({ ...validSnippet, createdAt: -1 })).toThrow()
        expect(() => TerminalSnippetSchema.parse({ ...validSnippet, updatedAt: 1.5 })).toThrow()
    })

    it('limits a namespace response to the configured number of snippets', () => {
        expect(TerminalSnippetsResponseSchema.parse({
            snippets: Array.from(
                { length: TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE },
                (_, index) => ({ ...validSnippet, id: `snippet-${index}` })
            )
        }).snippets).toHaveLength(TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE)

        expect(() => TerminalSnippetsResponseSchema.parse({
            snippets: Array.from(
                { length: TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE + 1 },
                (_, index) => ({ ...validSnippet, id: `snippet-${index}` })
            )
        })).toThrow()
    })
})

describe('SyncEventSchema terminal snippet event', () => {
    it('accepts namespaced terminal snippet updates', () => {
        expect(SyncEventSchema.parse({
            type: 'terminal-snippets-updated',
            namespace: 'team-a'
        })).toEqual({
            type: 'terminal-snippets-updated',
            namespace: 'team-a'
        })
    })

    it('rejects an invalid namespace shape', () => {
        expect(() => SyncEventSchema.parse({
            type: 'terminal-snippets-updated',
            namespace: 42
        })).toThrow()
    })
})
