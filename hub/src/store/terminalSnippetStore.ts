import { TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE } from '@hapi/protocol'
import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredTerminalSnippet } from './types'

type TerminalSnippetRow = {
    id: string
    namespace: string
    name: string
    command: string
    description: string | null
    created_at: number
    updated_at: number
}

type TerminalSnippetContent = {
    namespace: string
    name: string
    command: string
    description: string | null
    now?: number
}

export class TerminalSnippetStore {
    constructor(private readonly db: Database) {}

    list(namespace: string): StoredTerminalSnippet[] {
        const rows = this.db.prepare(`
            SELECT *
            FROM terminal_snippets
            WHERE namespace = ?
            ORDER BY created_at DESC, id DESC
        `).all(namespace) as TerminalSnippetRow[]
        return rows.map(toTerminalSnippet)
    }

    create(input: TerminalSnippetContent): StoredTerminalSnippet {
        return this.db.transaction(() => {
            const countRow = this.db.prepare(`
                SELECT COUNT(*) AS count
                FROM terminal_snippets
                WHERE namespace = ?
            `).get(input.namespace) as { count: number }
            if (countRow.count >= TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE) {
                throw new Error('TERMINAL_SNIPPET_LIMIT_REACHED')
            }

            const id = randomUUID()
            const now = input.now ?? Date.now()
            this.db.prepare(`
                INSERT INTO terminal_snippets (
                    id, namespace, name, command, description, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                input.namespace,
                input.name,
                input.command,
                input.description,
                now,
                now
            )

            return {
                id,
                namespace: input.namespace,
                name: input.name,
                command: input.command,
                description: input.description,
                createdAt: now,
                updatedAt: now
            }
        }).immediate()
    }

    update(input: TerminalSnippetContent & { id: string }): StoredTerminalSnippet {
        const now = input.now ?? Date.now()
        const result = this.db.prepare(`
            UPDATE terminal_snippets
            SET name = ?, command = ?, description = ?, updated_at = ?
            WHERE namespace = ? AND id = ?
        `).run(
            input.name,
            input.command,
            input.description,
            now,
            input.namespace,
            input.id
        )
        if (result.changes !== 1) {
            throw new Error('TERMINAL_SNIPPET_NOT_FOUND')
        }

        return this.get(input.namespace, input.id)!
    }

    delete(namespace: string, id: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM terminal_snippets WHERE namespace = ? AND id = ?'
        ).run(namespace, id)
        return result.changes === 1
    }

    private get(namespace: string, id: string): StoredTerminalSnippet | null {
        const row = this.db.prepare(`
            SELECT *
            FROM terminal_snippets
            WHERE namespace = ? AND id = ?
        `).get(namespace, id) as TerminalSnippetRow | undefined
        return row ? toTerminalSnippet(row) : null
    }
}

function toTerminalSnippet(row: TerminalSnippetRow): StoredTerminalSnippet {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        command: row.command,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}
