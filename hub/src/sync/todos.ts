import { isObject } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import { TodoItemSchema, TodosSchema } from '@hapi/protocol/schemas'
import type { TodoItem } from '@hapi/protocol/types'

export { TodoItemSchema, TodosSchema }
export type { TodoItem }

export type SessionTodoUpdate =
    | { type: 'replace'; todos: TodoItem[] }
    | { type: 'create'; todo: TodoItem }
    | { type: 'patch'; id: string; changes: Partial<Omit<TodoItem, 'id'>> }
    | { type: 'delete'; id: string }

export type SessionTodoExtraction = {
    updates: SessionTodoUpdate[]
    issues: Array<{ source: 'claude' | 'codex' | 'acp'; reason: string }>
}

export type SessionTodoReduction =
    | { kind: 'changed'; todos: TodoItem[] }
    | { kind: 'unchanged' }
    | { kind: 'rejected'; reason: string }

const STATUS_MAP: Record<string, TodoItem['status'] | undefined> = {
    pending: 'pending',
    inProgress: 'in_progress',
    in_progress: 'in_progress',
    completed: 'completed'
}

function makeSnapshotId(source: 'claude-todo' | 'codex-plan' | 'acp-plan', index: number): string {
    return `${source}-${index + 1}`
}

function hasUniqueIds(todos: readonly TodoItem[]): boolean {
    const ids = new Set<string>()
    for (const todo of todos) {
        if (!todo.id || ids.has(todo.id)) return false
        ids.add(todo.id)
    }
    return true
}

function todoItemsEqual(left: TodoItem, right: TodoItem): boolean {
    return left.id === right.id
        && left.content === right.content
        && left.status === right.status
        && left.priority === right.priority
        && left.activeForm === right.activeForm
}

function todoSnapshotsEqual(left: readonly TodoItem[], right: readonly TodoItem[]): boolean {
    return left.length === right.length
        && left.every((todo, index) => todoItemsEqual(todo, right[index]))
}

function validateSnapshot(candidate: unknown): TodoItem[] | null {
    const parsed = TodosSchema.safeParse(candidate)
    return parsed.success && hasUniqueIds(parsed.data) ? parsed.data : null
}

function issue(
    source: SessionTodoExtraction['issues'][number]['source'],
    reason: string
): SessionTodoExtraction {
    return { updates: [], issues: [{ source, reason }] }
}

function getClaudeData(messageContent: unknown): Record<string, unknown> | null {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record || (record.role !== 'agent' && record.role !== 'assistant')) return null
    if (!isObject(record.content) || record.content.type !== 'output') return null
    return isObject(record.content.data) ? record.content.data : null
}

function getMessageBlocks(data: Record<string, unknown>): Record<string, unknown>[] {
    const message = isObject(data.message) ? data.message : null
    if (!message || !Array.isArray(message.content)) return []
    return message.content.filter(isObject)
}

function mapClaudeTodoSnapshot(candidate: unknown): TodoItem[] | null {
    if (!Array.isArray(candidate)) return null
    const todos: unknown[] = []
    for (let index = 0; index < candidate.length; index++) {
        const todo = candidate[index]
        if (!isObject(todo) || typeof todo.content !== 'string' || todo.content.length === 0) return null
        todos.push({
            ...todo,
            id: typeof todo.id === 'string' && todo.id.length > 0
                ? todo.id
                : makeSnapshotId('claude-todo', index)
        })
    }
    return validateSnapshot(todos)
}

function extractClaudeTodoWrite(data: Record<string, unknown>): SessionTodoExtraction {
    const updates: SessionTodoUpdate[] = []
    const issues: SessionTodoExtraction['issues'] = []

    for (const block of getMessageBlocks(data)) {
        if (block.type !== 'tool_use' || block.name !== 'TodoWrite') continue
        const input = isObject(block.input) ? block.input : null
        const todos = input ? mapClaudeTodoSnapshot(input.todos) : null
        if (!todos) {
            issues.push({ source: 'claude', reason: 'invalid TodoWrite snapshot' })
            continue
        }
        updates.push({ type: 'replace', todos })
    }

    return { updates, issues }
}

type ClaudeToolCall = {
    name: string
    input: Record<string, unknown>
}

function findClaudeToolCall(
    toolUseId: string,
    recentMessageContents: readonly unknown[]
): ClaudeToolCall | null {
    const start = Math.max(0, recentMessageContents.length - 200)
    for (let index = recentMessageContents.length - 1; index >= start; index--) {
        const data = getClaudeData(recentMessageContents[index])
        if (!data || data.type !== 'assistant' || data.isSidechain === true) continue
        const blocks = getMessageBlocks(data)
        for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex--) {
            const block = blocks[blockIndex]
            if (block.type !== 'tool_use' || block.id !== toolUseId) continue
            if (typeof block.name !== 'string' || !isObject(block.input)) return null
            return { name: block.name, input: block.input }
        }
    }
    return null
}

function parseJsonValue(value: unknown): unknown {
    let json: string | null = null
    if (typeof value === 'string') {
        json = value
    } else if (Array.isArray(value)) {
        const textParts: string[] = []
        for (const block of value) {
            if (!isObject(block) || block.type !== 'text' || typeof block.text !== 'string') return null
            textParts.push(block.text)
        }
        json = textParts.join('')
    } else if (isObject(value)) {
        return value
    }
    if (json === null) return null
    try {
        return JSON.parse(json)
    } catch {
        return null
    }
}

function looksLikeTaskResult(value: unknown): boolean {
    const parsed = parseJsonValue(value)
    return isObject(parsed) && ('task' in parsed || 'tasks' in parsed || 'success' in parsed)
}

function extractTaskCreate(
    input: Record<string, unknown>,
    output: unknown
): SessionTodoExtraction {
    const parsed = parseJsonValue(output)
    const task = isObject(parsed) && isObject(parsed.task) ? parsed.task : null
    if (!task || typeof task.id !== 'string' || task.id.length === 0
        || typeof task.subject !== 'string' || task.subject.length === 0) {
        return issue('claude', 'invalid TaskCreate result')
    }
    const todo: TodoItem = {
        id: task.id,
        content: task.subject,
        status: 'pending',
        priority: 'medium'
    }
    if (typeof input.activeForm === 'string') todo.activeForm = input.activeForm
    return { updates: [{ type: 'create', todo }], issues: [] }
}

function extractTaskUpdate(
    input: Record<string, unknown>,
    output: unknown
): SessionTodoExtraction {
    const parsed = parseJsonValue(output)
    if (!isObject(parsed) || parsed.success !== true) {
        return issue('claude', 'unsuccessful TaskUpdate result')
    }
    if (typeof input.taskId !== 'string' || input.taskId.length === 0) {
        return issue('claude', 'invalid TaskUpdate task ID')
    }
    if (input.status === 'deleted') {
        return { updates: [{ type: 'delete', id: input.taskId }], issues: [] }
    }

    const changes: Partial<Omit<TodoItem, 'id'>> = {}
    if (typeof input.subject === 'string' && input.subject.length > 0) changes.content = input.subject
    if (typeof input.activeForm === 'string') changes.activeForm = input.activeForm
    if (typeof input.status === 'string') {
        const status = STATUS_MAP[input.status]
        if (status) changes.status = status
    }
    if (Object.keys(changes).length === 0) return { updates: [], issues: [] }
    return { updates: [{ type: 'patch', id: input.taskId, changes }], issues: [] }
}

function mapTaskListSnapshot(output: unknown): TodoItem[] | null {
    const parsed = parseJsonValue(output)
    if (!isObject(parsed) || !Array.isArray(parsed.tasks)) return null
    const todos: TodoItem[] = []
    for (const task of parsed.tasks) {
        if (!isObject(task) || typeof task.id !== 'string' || task.id.length === 0
            || typeof task.subject !== 'string' || task.subject.length === 0
            || typeof task.status !== 'string') return null
        const status = STATUS_MAP[task.status]
        if (!status) return null
        todos.push({
            id: task.id,
            content: task.subject,
            status,
            priority: 'medium'
        })
    }
    return validateSnapshot(todos)
}

function extractTaskList(output: unknown): SessionTodoExtraction {
    const todos = mapTaskListSnapshot(output)
    return todos
        ? { updates: [{ type: 'replace', todos }], issues: [] }
        : issue('claude', 'invalid TaskList snapshot')
}

function extractClaudeToolResults(
    data: Record<string, unknown>,
    recentMessageContents: readonly unknown[]
): SessionTodoExtraction {
    const updates: SessionTodoUpdate[] = []
    const issues: SessionTodoExtraction['issues'] = []
    for (const block of getMessageBlocks(data)) {
        if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
        const output = data.toolUseResult ?? block.content
        const call = findClaudeToolCall(block.tool_use_id, recentMessageContents)
        if (!call) {
            if (looksLikeTaskResult(output)) {
                issues.push({ source: 'claude', reason: `unmatched task result: ${block.tool_use_id}` })
            }
            continue
        }
        if (call.name !== 'TaskCreate' && call.name !== 'TaskUpdate' && call.name !== 'TaskList') continue
        if (block.is_error === true) {
            issues.push({ source: 'claude', reason: `failed ${call.name} result` })
            continue
        }

        const extracted = call.name === 'TaskCreate'
            ? extractTaskCreate(call.input, output)
            : call.name === 'TaskUpdate'
                ? extractTaskUpdate(call.input, output)
                : extractTaskList(output)
        updates.push(...extracted.updates)
        issues.push(...extracted.issues)
    }
    return { updates, issues }
}

function mapCodexSnapshot(candidate: unknown): TodoItem[] | null {
    if (!Array.isArray(candidate)) return null
    const todos: TodoItem[] = []
    for (let index = 0; index < candidate.length; index++) {
        const item = candidate[index]
        if (!isObject(item) || typeof item.step !== 'string' || item.step.length === 0
            || typeof item.status !== 'string') return null
        const status = STATUS_MAP[item.status]
        if (!status) return null
        todos.push({
            id: makeSnapshotId('codex-plan', index),
            content: item.step,
            status,
            priority: 'medium'
        })
    }
    return validateSnapshot(todos)
}

function extractCodex(data: Record<string, unknown>): SessionTodoExtraction | null {
    if (data.type !== 'tool-call' || data.name !== 'update_plan') return null
    const input = isObject(data.input) ? data.input : null
    const todos = input ? mapCodexSnapshot(input.plan) : null
    return todos
        ? { updates: [{ type: 'replace', todos }], issues: [] }
        : issue('codex', 'invalid update_plan snapshot')
}

function mapAcpSnapshot(candidate: unknown): TodoItem[] | null {
    if (!Array.isArray(candidate)) return null
    const todos: TodoItem[] = []
    for (let index = 0; index < candidate.length; index++) {
        const item = candidate[index]
        if (!isObject(item) || typeof item.content !== 'string' || item.content.length === 0
            || typeof item.priority !== 'string' || typeof item.status !== 'string') return null
        const status = STATUS_MAP[item.status]
        if (!status) return null
        todos.push({
            id: typeof item.id === 'string' && item.id.length > 0
                ? item.id
                : makeSnapshotId('acp-plan', index),
            content: item.content,
            status,
            priority: item.priority
        } as TodoItem)
    }
    return validateSnapshot(todos)
}

function extractAcp(data: Record<string, unknown>): SessionTodoExtraction | null {
    if (data.type !== 'plan') return null
    const todos = mapAcpSnapshot(data.entries)
    return todos
        ? { updates: [{ type: 'replace', todos }], issues: [] }
        : issue('acp', 'invalid plan snapshot')
}

export function extractSessionTodoUpdates(
    messageContent: unknown,
    recentMessageContents: readonly unknown[] = []
): SessionTodoExtraction {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record || (record.role !== 'agent' && record.role !== 'assistant')) {
        return { updates: [], issues: [] }
    }
    if (!isObject(record.content)) return { updates: [], issues: [] }

    if (record.content.type === 'output') {
        const data = isObject(record.content.data) ? record.content.data : null
        if (!data || data.isSidechain === true) return { updates: [], issues: [] }
        if (data.type === 'assistant') return extractClaudeTodoWrite(data)
        if (data.type === 'user') return extractClaudeToolResults(data, recentMessageContents)
        return { updates: [], issues: [] }
    }
    if (record.content.type !== 'codex' || !isObject(record.content.data)) {
        return { updates: [], issues: [] }
    }
    return extractCodex(record.content.data)
        ?? extractAcp(record.content.data)
        ?? { updates: [], issues: [] }
}

export function reduceSessionTodos(
    current: readonly TodoItem[] | null,
    updates: readonly SessionTodoUpdate[]
): SessionTodoReduction {
    if (updates.length === 0) return { kind: 'unchanged' }
    let next = current ? current.map((todo) => ({ ...todo })) : []
    let touched = false

    for (const update of updates) {
        if (update.type === 'replace') {
            next = update.todos.map((todo) => ({ ...todo }))
            touched = true
            continue
        }
        if (update.type === 'create') {
            const existing = next.find((todo) => todo.id === update.todo.id)
            if (existing && !todoItemsEqual(existing, update.todo)) {
                return { kind: 'rejected', reason: `conflicting duplicate id: ${update.todo.id}` }
            }
            if (!existing) {
                next.push({ ...update.todo })
                touched = true
            }
            continue
        }
        const index = next.findIndex((todo) => todo.id === update.id)
        if (index < 0) continue
        if (update.type === 'delete') {
            next.splice(index, 1)
            touched = true
            continue
        }
        const patched = { ...next[index], ...update.changes, id: update.id }
        if (!todoItemsEqual(patched, next[index])) {
            next[index] = patched
            touched = true
        }
    }

    const parsed = TodosSchema.safeParse(next)
    if (!parsed.success || !hasUniqueIds(parsed.data)) {
        return { kind: 'rejected', reason: 'invalid todo snapshot' }
    }
    if (!touched || (current !== null && todoSnapshotsEqual(current, parsed.data))) {
        return { kind: 'unchanged' }
    }
    return { kind: 'changed', todos: parsed.data }
}

function detectSource(messageContent: unknown): 'claude' | 'codex' | 'acp' {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (record && isObject(record.content) && record.content.type === 'codex'
        && isObject(record.content.data) && record.content.data.type === 'plan') return 'acp'
    if (record && isObject(record.content) && record.content.type === 'codex') return 'codex'
    return 'claude'
}

export function replaySessionTodos(
    messages: readonly { content: unknown; createdAt: number }[]
): { todos: TodoItem[]; updatedAt: number; issues: SessionTodoExtraction['issues'] } | null {
    let todos: TodoItem[] | null = null
    let updatedAt = 0
    const issues: SessionTodoExtraction['issues'] = []

    messages.forEach((message, index) => {
        const recentMessageContents = messages
            .slice(Math.max(0, index - 200), index)
            .map((item) => item.content)
        const extraction = extractSessionTodoUpdates(message.content, recentMessageContents)
        issues.push(...extraction.issues)
        const reduction = reduceSessionTodos(todos, extraction.updates)
        if (reduction.kind === 'rejected') {
            issues.push({ source: detectSource(message.content), reason: reduction.reason })
        } else if (reduction.kind === 'changed') {
            todos = reduction.todos
            updatedAt = message.createdAt
        }
    })

    return todos === null ? null : { todos, updatedAt, issues }
}
