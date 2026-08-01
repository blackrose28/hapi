import { Database } from 'bun:sqlite'
import { ScratchlistEntry } from '@hapi/protocol/schemas'
import * as dbFuncs from './scratchlist'

export class ScratchlistStore {
    constructor(private readonly db: Database) {}

    list(sessionId: string): ScratchlistEntry[] {
        return dbFuncs.listScratchlistEntrys(this.db, sessionId)
    }

    replace(sessionId: string, items: ScratchlistEntry[]): void {
        dbFuncs.replaceScratchlistEntrys(this.db, sessionId, items)
    }

    transfer(fromSessionId: string, toSessionId: string) {
        return dbFuncs.transferScratchlistEntrys(this.db, fromSessionId, toSessionId)
    }
    
    deleteAttachment(sessionId: string, attachmentId: string): boolean {
        return dbFuncs.deleteScratchlistAttachmentById(this.db, sessionId, attachmentId)
    }
}
