import { describe, expect, it } from 'bun:test'
import {
    extractSessionTodoUpdates,
    reduceSessionTodos,
    replaySessionTodos,
    TodosSchema
} from './todos'

const pending = {
    id: '1',
    content: 'Build API',
    status: 'pending' as const,
    priority: 'medium' as const
}

function claudeCall(
    name: string,
    input: Record<string, unknown>,
    options: { id?: string; sidechain?: boolean } = {}
): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                isSidechain: options.sidechain ?? false,
                message: {
                    content: [{
                        type: 'tool_use',
                        id: options.id ?? 'tool-1',
                        name,
                        input
                    }]
                }
            }
        }
    }
}

function claudeResult(
    content: unknown,
    options: { id?: string; error?: boolean; sidechain?: boolean; toolUseResult?: unknown } = {}
): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'user',
                isSidechain: options.sidechain ?? false,
                ...(options.toolUseResult === undefined ? {} : { toolUseResult: options.toolUseResult }),
                message: {
                    content: [{
                        type: 'tool_result',
                        tool_use_id: options.id ?? 'tool-1',
                        is_error: options.error ?? false,
                        content
                    }]
                }
            }
        }
    }
}

describe('session todo projection', () => {
    describe('reducer', () => {
        it('applies create, patch and delete without changing unaffected order', () => {
            const result = reduceSessionTodos(
                [pending, { ...pending, id: '2', content: 'Build UI' }],
                [
                    { type: 'patch', id: '2', changes: { status: 'in_progress' } },
                    { type: 'delete', id: '1' }
                ]
            )

            expect(result).toEqual({
                kind: 'changed',
                todos: [{ ...pending, id: '2', content: 'Build UI', status: 'in_progress' }]
            })
        })

        it('distinguishes no snapshot from an authoritative empty snapshot', () => {
            expect(reduceSessionTodos(null, [{ type: 'replace', todos: [] }]))
                .toEqual({ kind: 'changed', todos: [] })
        })

        it('rejects duplicate IDs in a full snapshot', () => {
            expect(reduceSessionTodos([], [{
                type: 'replace',
                todos: [pending, { ...pending }]
            }])).toEqual({ kind: 'rejected', reason: 'invalid todo snapshot' })
        })

        it('treats an identical create as a no-op and rejects a conflicting duplicate', () => {
            expect(reduceSessionTodos([pending], [{ type: 'create', todo: { ...pending } }]))
                .toEqual({ kind: 'unchanged' })
            expect(reduceSessionTodos([pending], [{
                type: 'create',
                todo: { ...pending, content: 'Different' }
            }])).toEqual({ kind: 'rejected', reason: 'conflicting duplicate id: 1' })
        })

        it('compares duplicate creates semantically after schema normalization', () => {
            const current = TodosSchema.parse([pending])
            const sameTodoWithDifferentPropertyOrder = {
                priority: 'medium' as const,
                status: 'pending' as const,
                content: 'Build API',
                id: '1'
            }

            expect(reduceSessionTodos(current, [{
                type: 'create',
                todo: sameTodoWithDifferentPropertyOrder
            }])).toEqual({ kind: 'unchanged' })
        })

        it('ignores patch and delete updates for unknown IDs', () => {
            expect(reduceSessionTodos([pending], [
                { type: 'patch', id: 'missing', changes: { status: 'completed' } },
                { type: 'delete', id: 'also-missing' }
            ])).toEqual({ kind: 'unchanged' })
        })

        it('rejects a reduced snapshot that fails the todo schema', () => {
            expect(reduceSessionTodos([pending], [{
                type: 'patch',
                id: '1',
                changes: { status: 'invalid' }
            } as never])).toEqual({ kind: 'rejected', reason: 'invalid todo snapshot' })
        })
    })

    describe('full snapshot adapters', () => {
        it('extracts full and empty Claude TodoWrite snapshots with deterministic missing IDs', () => {
            expect(extractSessionTodoUpdates(claudeCall('TodoWrite', {
                todos: [{ content: 'Ship', status: 'in_progress', priority: 'high' }]
            })).updates).toEqual([{ type: 'replace', todos: [{
                id: 'claude-todo-1',
                content: 'Ship',
                status: 'in_progress',
                priority: 'high'
            }] }])
            expect(extractSessionTodoUpdates(claudeCall('TodoWrite', { todos: [] })).updates)
                .toEqual([{ type: 'replace', todos: [] }])
        })

        it('extracts a Codex update_plan snapshot and maps statuses', () => {
            const result = extractSessionTodoUpdates({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call',
                        name: 'update_plan',
                        input: {
                            plan: [
                                { step: 'First', status: 'inProgress' },
                                { step: 'Second', status: 'completed' }
                            ]
                        }
                    }
                }
            })

            expect(result).toEqual({
                updates: [{ type: 'replace', todos: [
                    { id: 'codex-plan-1', content: 'First', status: 'in_progress', priority: 'medium' },
                    { id: 'codex-plan-2', content: 'Second', status: 'completed', priority: 'medium' }
                ] }],
                issues: []
            })
        })

        it('extracts full and empty ACP plans', () => {
            expect(extractSessionTodoUpdates({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'plan',
                        entries: [{ content: 'ACP task', priority: 'low', status: 'pending' }]
                    }
                }
            }).updates).toEqual([{ type: 'replace', todos: [{
                id: 'acp-plan-1', content: 'ACP task', priority: 'low', status: 'pending'
            }] }])
            expect(extractSessionTodoUpdates({
                role: 'agent',
                content: { type: 'codex', data: { type: 'plan', entries: [] } }
            }).updates).toEqual([{ type: 'replace', todos: [] }])
        })

        it('rejects one malformed ACP entry instead of partially replacing', () => {
            const result = extractSessionTodoUpdates({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'plan',
                        entries: [
                            { content: 'Valid', priority: 'medium', status: 'pending' },
                            { content: '', priority: 'medium', status: 'pending' }
                        ]
                    }
                }
            })

            expect(result.updates).toEqual([])
            expect(result.issues).toHaveLength(1)
        })

        it('rejects malformed and duplicate-ID full snapshots atomically', () => {
            const malformedCodex = extractSessionTodoUpdates({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call',
                        name: 'update_plan',
                        input: { plan: [{ step: 'Valid', status: 'unknown' }] }
                    }
                }
            })
            const duplicateAcp = extractSessionTodoUpdates({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'plan',
                        entries: [
                            { id: 'same', content: 'One', priority: 'medium', status: 'pending' },
                            { id: 'same', content: 'Two', priority: 'medium', status: 'pending' }
                        ]
                    }
                }
            })

            expect(malformedCodex.updates).toEqual([])
            expect(malformedCodex.issues).toHaveLength(1)
            expect(duplicateAcp.updates).toEqual([])
            expect(duplicateAcp.issues).toHaveLength(1)
        })
    })

    describe('Claude task tools', () => {
        it('creates a task after a successful matching TaskCreate result', () => {
            const call = claudeCall('TaskCreate', {
                subject: 'Original subject',
                activeForm: 'Creating task'
            })
            const result = extractSessionTodoUpdates(
                claudeResult(JSON.stringify({ task: { id: '42', subject: 'Created subject' } })),
                [call]
            )

            expect(result).toEqual({
                updates: [{ type: 'create', todo: {
                    id: '42',
                    content: 'Created subject',
                    activeForm: 'Creating task',
                    status: 'pending',
                    priority: 'medium'
                } }],
                issues: []
            })
        })

        it('prefers the structured Claude TaskCreateOutput from the current wire', () => {
            const result = extractSessionTodoUpdates(
                claudeResult('Task created', {
                    toolUseResult: { task: { id: '43', subject: 'Structured subject' } }
                }),
                [claudeCall('TaskCreate', { subject: 'Requested subject' })]
            )

            expect(result.updates).toEqual([{ type: 'create', todo: {
                id: '43',
                content: 'Structured subject',
                status: 'pending',
                priority: 'medium'
            } }])
        })

        it('uses structured SDK results when TaskUpdate and TaskList display text is not JSON', () => {
            const update = extractSessionTodoUpdates(
                claudeResult('Task #43 updated successfully', {
                    toolUseResult: { success: true }
                }),
                [claudeCall('TaskUpdate', { taskId: '43', status: 'completed' })]
            )
            const list = extractSessionTodoUpdates(
                claudeResult('43 [completed] Structured subject', {
                    id: 'task-list-1',
                    toolUseResult: {
                        tasks: [{ id: '43', subject: 'Structured subject', status: 'completed' }]
                    }
                }),
                [claudeCall('TaskList', {}, { id: 'task-list-1' })]
            )

            expect(update).toEqual({
                updates: [{ type: 'patch', id: '43', changes: { status: 'completed' } }],
                issues: []
            })
            expect(list).toEqual({
                updates: [{ type: 'replace', todos: [{
                    id: '43',
                    content: 'Structured subject',
                    status: 'completed',
                    priority: 'medium'
                }] }],
                issues: []
            })
        })

        it('does not create a task for a failed or unmatched TaskCreate result', () => {
            const failed = extractSessionTodoUpdates(
                claudeResult('{"task":{"id":"42","subject":"Nope"}}', { error: true }),
                [claudeCall('TaskCreate', { subject: 'Nope' })]
            )
            const unmatched = extractSessionTodoUpdates(
                claudeResult('{"task":{"id":"42","subject":"Nope"}}', { id: 'missing' }),
                [claudeCall('TaskCreate', { subject: 'Nope' })]
            )

            expect(failed.updates).toEqual([])
            expect(failed.issues).toHaveLength(1)
            expect(unmatched.updates).toEqual([])
            expect(unmatched.issues).toHaveLength(1)
        })

        it('maps TaskUpdate status, subject and active form after success', () => {
            const result = extractSessionTodoUpdates(
                claudeResult('{"success":true}'),
                [claudeCall('TaskUpdate', {
                    taskId: '42',
                    status: 'in_progress',
                    subject: 'Renamed',
                    activeForm: 'Working'
                })]
            )

            expect(result).toEqual({
                updates: [{ type: 'patch', id: '42', changes: {
                    status: 'in_progress',
                    content: 'Renamed',
                    activeForm: 'Working'
                } }],
                issues: []
            })
        })

        it('maps a successful deleted TaskUpdate to delete', () => {
            expect(extractSessionTodoUpdates(
                claudeResult({ success: true }),
                [claudeCall('TaskUpdate', { taskId: '42', status: 'deleted' })]
            ).updates).toEqual([{ type: 'delete', id: '42' }])
        })

        it('ignores a TaskUpdate with no recognized display changes', () => {
            expect(extractSessionTodoUpdates(
                claudeResult('{"success":true}'),
                [claudeCall('TaskUpdate', { taskId: '42', owner: 'worker' })]
            )).toEqual({ updates: [], issues: [] })
        })

        it('replaces from full and empty TaskList JSON results', () => {
            const call = claudeCall('TaskList', {})
            const full = extractSessionTodoUpdates(claudeResult([
                { type: 'text', text: '{"tasks":[' },
                { type: 'text', text: '{"id":"1","subject":"Listed","status":"in_progress"}' },
                { type: 'text', text: ']}' }
            ]), [call])
            const empty = extractSessionTodoUpdates(claudeResult('{"tasks":[]}'), [call])

            expect(full.updates).toEqual([{ type: 'replace', todos: [{
                id: '1', content: 'Listed', status: 'in_progress', priority: 'medium'
            }] }])
            expect(empty.updates).toEqual([{ type: 'replace', todos: [] }])
        })

        it('rejects a malformed TaskList result atomically', () => {
            const result = extractSessionTodoUpdates(
                claudeResult('{"tasks":[{"id":"1","subject":"Valid","status":"pending"},{"id":"2","subject":"","status":"pending"}]}'),
                [claudeCall('TaskList', {})]
            )

            expect(result.updates).toEqual([])
            expect(result.issues).toHaveLength(1)
        })

        it('ignores sidechain results and calls when matching task tools', () => {
            const sidechainResult = extractSessionTodoUpdates(
                claudeResult('{"success":true}', { sidechain: true }),
                [claudeCall('TaskUpdate', { taskId: '42', status: 'completed' })]
            )
            const sidechainCall = extractSessionTodoUpdates(
                claudeResult('{"success":true}'),
                [claudeCall('TaskUpdate', { taskId: '42', status: 'completed' }, { sidechain: true })]
            )

            expect(sidechainResult).toEqual({ updates: [], issues: [] })
            expect(sidechainCall.updates).toEqual([])
            expect(sidechainCall.issues).toHaveLength(1)
        })
    })

    it('replays updates in order and timestamps only changed snapshots', () => {
        const messages = [
            { content: claudeCall('TodoWrite', { todos: [pending] }), createdAt: 10 },
            { content: claudeCall('TaskUpdate', { taskId: '1', status: 'completed' }), createdAt: 20 },
            { content: claudeResult('{"success":true}'), createdAt: 30 },
            { content: claudeCall('TaskUpdate', { taskId: 'missing', status: 'completed' }), createdAt: 40 },
            { content: claudeResult('{"success":true}'), createdAt: 50 }
        ]

        expect(replaySessionTodos(messages)).toEqual({
            todos: [{ ...pending, status: 'completed' }],
            updatedAt: 30,
            issues: []
        })
    })

    it('treats TaskGet call and result as read-only during replay', () => {
        const messages = [
            { content: claudeCall('TodoWrite', { todos: [pending] }), createdAt: 10 },
            { content: claudeCall('TaskGet', { taskId: '1' }, { id: 'task-get-1' }), createdAt: 20 },
            {
                content: claudeResult('Task #1: Build API', {
                    id: 'task-get-1',
                    toolUseResult: { task: { id: '1', subject: 'Build API', status: 'pending' } }
                }),
                createdAt: 30
            }
        ]

        expect(extractSessionTodoUpdates(messages[2].content, [messages[1].content]))
            .toEqual({ updates: [], issues: [] })
        expect(replaySessionTodos(messages)).toEqual({
            todos: [pending],
            updatedAt: 10,
            issues: []
        })
    })

    it('preserves input causality when message timestamps move backwards', () => {
        const messages = [
            {
                content: {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'tool-call',
                            name: 'update_plan',
                            input: { plan: [{ step: 'Plan A', status: 'inProgress' }] }
                        }
                    }
                },
                createdAt: 200
            },
            {
                content: {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'tool-call',
                            name: 'update_plan',
                            input: { plan: [{ step: 'Plan B', status: 'completed' }] }
                        }
                    }
                },
                createdAt: 100
            }
        ]

        expect(replaySessionTodos(messages)).toEqual({
            todos: [{
                id: 'codex-plan-1',
                content: 'Plan B',
                status: 'completed',
                priority: 'medium'
            }],
            updatedAt: 100,
            issues: []
        })
    })
})
