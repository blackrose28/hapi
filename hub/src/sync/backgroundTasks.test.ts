import { describe, expect, it } from 'bun:test'
import { extractBackgroundTaskDelta } from './backgroundTasks'

describe('extractBackgroundTaskDelta', () => {
    it('counts a background bash command start', () => {
        const message = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'tool_result',
                    content: 'Command running in background with ID: bash-1'
                }
            }
        }

        expect(extractBackgroundTaskDelta(message)).toEqual({ started: 1, completed: 0 })
    })

    it('counts an async agent launch as a start, so the session stays busy while the subagent runs', () => {
        const message = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_result',
                                content: 'Async agent launched successfully. (This tool result is internal metadata...)\nagentId: a7b702cddc7d8364c'
                            }
                        ]
                    }
                }
            }
        }

        expect(extractBackgroundTaskDelta(message)).toEqual({ started: 1, completed: 0 })
    })

    it('counts an async agent launch as a start when the SDK returns structured metadata instead of text', () => {
        const message = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'tool_result',
                    content: { agentId: 'a7b702cddc7d8364c', output_file: '/tmp/agent-output.jsonl' }
                }
            }
        }

        expect(extractBackgroundTaskDelta(message)).toEqual({ started: 1, completed: 0 })
    })

    it('counts a task-notification as a completion regardless of which kind of background work started it', () => {
        const message = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    message: {
                        content: '<task-notification>\n<task-id>a7b702cddc7d8364c</task-id>\n</task-notification>'
                    }
                }
            }
        }

        expect(extractBackgroundTaskDelta(message)).toEqual({ started: 0, completed: 1 })
    })

    it('ignores unrelated tool results', () => {
        const message = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'tool_result',
                    content: 'Read 42 lines from file.ts'
                }
            }
        }

        expect(extractBackgroundTaskDelta(message)).toBeNull()
    })
})
