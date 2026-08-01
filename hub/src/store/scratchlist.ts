import { Database } from 'bun:sqlite'
import { ScratchlistEntry } from '@hapi/protocol/schemas'
import {
    parseScratchlistAttachmentsJson,
    serializeScratchlistAttachments,
} from '@hapi/protocol'

type DbScratchlistRow = {
    session_id: string
    id: string
    text: string
    created_at: number
    updated_at: number
    attachments: string | null
}

function toStoredItem(row: DbScratchlistRow): ScratchlistEntry {
    return {
        id: row.id,
        text: row.text,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        attachments: parseScratchlistAttachmentsJson(row.attachments),
    }
}

const SCRATCHLIST_ITEM_COLUMNS = `session_id, id, text, created_at, updated_at, attachments`

export function listScratchlistEntrys(
    db: Database,
    sessionId: string
): ScratchlistEntry[] {
    const rows = db.prepare(
        `SELECT ${SCRATCHLIST_ITEM_COLUMNS}
         FROM scratchlist_items
         WHERE session_id = ?
         ORDER BY created_at DESC, id DESC`
    ).all(sessionId) as DbScratchlistRow[]
    return rows.map(toStoredItem)
}

export function replaceScratchlistEntrys(
    db: Database,
    sessionId: string,
    items: ScratchlistEntry[]
): void {
    // Transaction wrapper will be outside or here
    db.prepare(`DELETE FROM scratchlist_items WHERE session_id = ?`).run(sessionId)
    const insert = db.prepare(
        `INSERT INTO scratchlist_items
            (session_id, id, text, created_at, updated_at, attachments)
         VALUES (@session_id, @id, @text, @created_at, @updated_at, @attachments)`
    )
    for (const item of items) {
        insert.run({
            session_id: sessionId,
            id: item.id,
            text: item.text,
            created_at: item.createdAt,
            updated_at: item.updatedAt ?? Date.now(),
            attachments: serializeScratchlistAttachments(item.attachments ?? [])
        })
    }
}

export function transferScratchlistEntrys(
    db: Database,
    fromSessionId: string,
    toSessionId: string
): { moved: number; collided: number } {
    if (fromSessionId === toSessionId) {
        return { moved: 0, collided: 0 }
    }
    try {
        db.exec('BEGIN')
        const before = db.prepare(
            'SELECT COUNT(*) AS n FROM scratchlist_items WHERE session_id = ?'
        ).get(fromSessionId) as { n: number } | undefined
        const total = before?.n ?? 0
        const moved = db.prepare(
            'UPDATE OR IGNORE scratchlist_items SET session_id = ? WHERE session_id = ?'
        ).run(toSessionId, fromSessionId).changes
        const collided = total - moved
        if (collided > 0) {
            db.prepare('DELETE FROM scratchlist_items WHERE session_id = ?').run(fromSessionId)
        }
        db.exec('COMMIT')
        return { moved, collided }
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}

export function deleteScratchlistAttachmentById(
    db: Database,
    sessionId: string,
    attachmentId: string
): boolean {
    const items = listScratchlistEntrys(db, sessionId)
    let modified = false
    const nextItems = items.map(item => {
        if (!item.attachments) return item
        const filtered = item.attachments.filter((a: any) => a.id !== attachmentId)
        if (filtered.length !== item.attachments.length) {
            modified = true
            return { ...item, attachments: filtered, updatedAt: Date.now() }
        }
        return item
    })
    
    if (modified) {
        replaceScratchlistEntrys(db, sessionId, nextItems)
        return true
    }
    return false
}
