import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import { PushStore } from './pushStore'
import { SessionStore } from './sessionStore'
import { TeamChatStore } from './teamChatStore'
import { TerminalSnippetStore } from './terminalSnippetStore'
import { UserStore } from './userStore'
import { ScratchlistStore } from './scratchlistStore'

export type {
    StoredMachine,
    StoredMessage,
    StoredPushSubscription,
    StoredSession,
    StoredTeamChat,
    StoredTeamMentionRequest,
    StoredTeamMessage,
    StoredTeamParticipant,
    StoredTerminalSnippet,
    StoredUser,
    VersionedUpdateResult
} from './types'
export type { CancelQueuedMessageResult, LookupQueuedMessageResult } from './messages'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { PushStore } from './pushStore'
export { SessionStore } from './sessionStore'
export { TeamChatStore } from './teamChatStore'
export { TerminalSnippetStore } from './terminalSnippetStore'
export { UserStore } from './userStore'
export { ScratchlistStore } from './scratchlistStore'

const SCHEMA_VERSION: number = 14
const REQUIRED_TABLES = [
    'sessions',
    'machines',
    'messages',
    'users',
    'push_subscriptions',
    'team_chats',
    'team_participants',
    'team_messages',
    'team_mention_requests',
    'scratchlist_items',
    'terminal_snippets'
] as const

export class Store {
    private db: Database
    private readonly _dbPath: string
    private closed: boolean = false

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: MessageStore
    readonly users: UserStore
    readonly scratchlist: ScratchlistStore
    readonly push: PushStore
    readonly teamChats: TeamChatStore
    readonly terminalSnippets: TerminalSnippetStore

    /**
     * Filesystem path of the underlying SQLite database, or ':memory:' for
     * in-memory stores. Used by the legacy → ACP migrator (#824) to take a
     * backup before a bulk run; treat as read-only.
     */
    get dbPath(): string {
        return this._dbPath
    }

    constructor(dbPath: string) {
        this._dbPath = dbPath
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.messages = new MessageStore(this.db)
        this.users = new UserStore(this.db)
        this.scratchlist = new ScratchlistStore(this.db)
        this.push = new PushStore(this.db)
        this.teamChats = new TeamChatStore(this.db)
        this.terminalSnippets = new TerminalSnippetStore(this.db)
    }

    close(): void {
        if (this.closed) return
        this.db.close()
        this.closed = true

        // Bun's SQLite close uses sqlite3_close_v2 by default, so prepared
        // statements that are already unreachable may keep the underlying file
        // handle alive until the next GC cycle. Windows refuses to remove a
        // directory while those SQLite WAL/SHM handles are still pending.
        if (process.platform === 'win32') {
            Bun.gc(true)
        }
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        // V1/V2/V3 entries cover legacy DBs that pre-date our migration ladder.
        // Each step is idempotent (column-existence guards inside) so we can
        // safely run the full V1→V8 chain in the legacy branch where the DB
        // shape is unknown.
        const buildStepMigrations = (legacy: boolean): Record<number, () => void> => ({
            1: () => this.migrateFromV1ToV2(legacy),
            2: () => this.migrateFromV2ToV3(),
            3: () => this.migrateFromV3ToV4(),
            4: () => this.migrateFromV4ToV5(),
            5: () => this.migrateFromV5ToV6(),
            6: () => this.migrateFromV6ToV7(),
            7: () => this.migrateFromV7ToV8(),
            8: () => this.migrateFromV8ToV9(),
            9: () => this.migrateFromV9ToV10(),
            10: () => this.migrateFromV10ToV11(),
            11: () => this.migrateFromV11ToV12(),
            12: () => this.migrateFromV12ToV13(),
            13: () => this.migrateFromV13ToV14(),
        })

        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                this.migrateLegacySchemaIfNeeded()
                // Run the full step ladder BEFORE createSchema so legacy tables
                // pick up every later-version column (e.g. invoked_at) via ALTER
                // TABLE.  Without this, createSchema below would try to build
                // idx_messages_session_position over a column that does not
                // exist yet, and CREATE TABLE IF NOT EXISTS would not add the
                // missing column to the existing table.
                const legacySteps = buildStepMigrations(true)
                for (let v = 1; v < SCHEMA_VERSION; v++) {
                    legacySteps[v]?.()
                }
                // Backfill any *missing* tables (sessions, machines, ...) that
                // a partially-built legacy DB may not have yet.
                this.createSchema()
                this.setUserVersion(SCHEMA_VERSION)
                return
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        const stepMigrations = buildStepMigrations(false)
        if (currentVersion < SCHEMA_VERSION && stepMigrations[currentVersion]) {
            for (let v = currentVersion; v < SCHEMA_VERSION; v++) {
                const step = stepMigrations[v]
                if (!step) throw this.buildSchemaMismatchError(currentVersion)
                step()
            }
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
        }

        this.assertRequiredTablesPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                agent_state TEXT,
                agent_state_version INTEGER DEFAULT 1,
                model TEXT,
                model_reasoning_effort TEXT,
                effort TEXT,
                todos TEXT,
                todos_updated_at INTEGER,
                team_state TEXT,
                team_state_updated_at INTEGER,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0,
                collapse_reasoning INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);

            CREATE TABLE IF NOT EXISTS machines (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                runner_state TEXT,
                runner_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                invoked_at INTEGER,
                scheduled_at INTEGER,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_messages_session_position
                ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_scheduled_pending
                ON messages(scheduled_at)
                WHERE scheduled_at IS NOT NULL AND invoked_at IS NULL;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);
        `)
        this.createTeamChatSchema()
        this.createTerminalSnippetSchema()
    }

    private createTeamChatSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS team_chats (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                owner_membership_id TEXT,
                name TEXT NOT NULL,
                project_path TEXT,
                shared_context TEXT,
                archived_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_team_chats_namespace_updated
                ON team_chats(namespace, updated_at DESC);

            CREATE TABLE IF NOT EXISTS team_participants (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                team_chat_id TEXT NOT NULL,
                type TEXT NOT NULL,
                user_id TEXT,
                session_id TEXT,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'general',
                color TEXT NOT NULL,
                archived_at INTEGER,
                joined_at INTEGER NOT NULL,
                FOREIGN KEY (team_chat_id) REFERENCES team_chats(id) ON DELETE CASCADE,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_team_participants_chat
                ON team_participants(team_chat_id, archived_at);
            CREATE INDEX IF NOT EXISTS idx_team_participants_session
                ON team_participants(namespace, session_id);

            CREATE TABLE IF NOT EXISTS team_messages (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                team_chat_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                author_participant_id TEXT NOT NULL,
                text TEXT NOT NULL,
                report_type TEXT,
                reply_to_message_id TEXT,
                reply_preview TEXT,
                mentions TEXT NOT NULL DEFAULT '[]',
                files TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (team_chat_id) REFERENCES team_chats(id) ON DELETE CASCADE,
                FOREIGN KEY (author_participant_id) REFERENCES team_participants(id) ON DELETE RESTRICT,
                FOREIGN KEY (reply_to_message_id) REFERENCES team_messages(id) ON DELETE SET NULL,
                UNIQUE(team_chat_id, seq)
            );
            CREATE INDEX IF NOT EXISTS idx_team_messages_chat_seq
                ON team_messages(team_chat_id, seq DESC);

            CREATE TABLE IF NOT EXISTS scratchlist_items (
                session_id TEXT NOT NULL,
                id TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                attachments TEXT,
                PRIMARY KEY (session_id, id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS team_mention_requests (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                team_chat_id TEXT NOT NULL,
                source_message_id TEXT NOT NULL,
                target_session_id TEXT NOT NULL,
                status TEXT NOT NULL,
                context_snapshot TEXT NOT NULL,
                hop_depth INTEGER NOT NULL DEFAULT 0,
                parent_request_id TEXT,
                error TEXT,
                created_at INTEGER NOT NULL,
                delivered_at INTEGER,
                seen_at INTEGER,
                processing_started_at INTEGER,
                resolved_at INTEGER,
                FOREIGN KEY (team_chat_id) REFERENCES team_chats(id) ON DELETE CASCADE,
                FOREIGN KEY (source_message_id) REFERENCES team_messages(id) ON DELETE CASCADE,
                FOREIGN KEY (target_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_request_id) REFERENCES team_mention_requests(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_team_mentions_session_status
                ON team_mention_requests(namespace, target_session_id, status, created_at);
            CREATE INDEX IF NOT EXISTS idx_team_mentions_message
                ON team_mention_requests(source_message_id);
        `)
    }

    private createTerminalSnippetSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS terminal_snippets (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                name TEXT NOT NULL,
                command TEXT NOT NULL,
                description TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_terminal_snippets_namespace_created
                ON terminal_snippets(namespace, created_at DESC, id DESC);
        `)
    }

    private migrateLegacySchemaIfNeeded(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            return
        }

        const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

        if (hasDaemon && hasRunner) {
            throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
        }

        if (hasDaemon && !hasRunner) {
            this.migrateFromV1ToV2()
        }
    }

    private migrateFromV1ToV2(legacy: boolean = false): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            // In the legacy branch the table may not exist yet — createSchema
            // will build the up-to-date one.  When invoked from the regular
            // upgrade path (user_version >= 1), missing the machines table is
            // still an error.
            if (legacy) return
            throw new Error('SQLite schema missing machines table for v1 to v2 migration.')
        }

        const hasDaemon = columns.has('daemon_state') && columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') && columns.has('runner_state_version')

        if (hasRunner && !hasDaemon) {
            return
        }

        if (!hasDaemon) {
            if (legacy) return
            throw new Error('SQLite schema missing daemon_state columns for v1 to v2 migration.')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
            this.db.exec('COMMIT')
            return
        } catch (error) {
            this.db.exec('ROLLBACK')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE machines_new (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    metadata TEXT,
                    metadata_version INTEGER DEFAULT 1,
                    runner_state TEXT,
                    runner_state_version INTEGER DEFAULT 1,
                    active INTEGER DEFAULT 0,
                    active_at INTEGER,
                    seq INTEGER DEFAULT 0
                );
            `)
            this.db.exec(`
                INSERT INTO machines_new (
                    id, namespace, created_at, updated_at,
                    metadata, metadata_version,
                    runner_state, runner_state_version,
                    active, active_at, seq
                )
                SELECT id, namespace, created_at, updated_at,
                       metadata, metadata_version,
                       daemon_state, daemon_state_version,
                       active, active_at, seq
                FROM machines;
            `)
            this.db.exec('DROP TABLE machines')
            this.db.exec('ALTER TABLE machines_new RENAME TO machines')
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
        }
    }

    private migrateFromV2ToV3(): void {
        return
    }

    private migrateFromV3ToV4(): void {
        const columns = this.getSessionColumnNames()
        // When the legacy branch invokes the full step ladder, an upstream-only
        // DB may not have the sessions table yet — createSchema runs after the
        // ladder.  Skip ALTERs in that case; createSchema will build the table
        // with the up-to-date columns.
        if (columns.size === 0) return
        if (!columns.has('team_state')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state TEXT')
        }
        if (!columns.has('team_state_updated_at')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state_updated_at INTEGER')
        }
    }

    private migrateFromV4ToV5(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('model')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model TEXT')
        }
    }

    private migrateFromV5ToV6(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN effort TEXT')
        }
    }

    private migrateFromV6ToV7(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('model_reasoning_effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT')
        }
    }


    private migrateFromV9ToV10(): void {
        this.createTeamChatSchema()
    }

    private migrateFromV10ToV11(): void {
        this.createTerminalSnippetSchema()
    }

    private migrateFromV11ToV12(): void {
        const columns = this.getTeamChatColumnNames()
        if (columns.size > 0 && !columns.has('owner_membership_id')) {
            this.db.exec('ALTER TABLE team_chats ADD COLUMN owner_membership_id TEXT')
        }
    }

    private migrateFromV12ToV13(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0 || !columns.has('machine_id') || !columns.has('metadata')) return
        this.db.exec(`
            UPDATE sessions
            SET machine_id = CASE
                WHEN json_valid(metadata) THEN
                    CASE WHEN json_type(metadata, '$.machineId') = 'text'
                        THEN json_extract(metadata, '$.machineId')
                        ELSE NULL
                    END
                ELSE NULL
            END
            WHERE machine_id IS NULL
        `)
    }

    private migrateFromV13ToV14(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS scratchlist_items (
                session_id TEXT NOT NULL,
                id TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                attachments TEXT,
                PRIMARY KEY (session_id, id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        `)
    }

    private migrateFromV7ToV8(): void {
        const columns = this.getMessageColumnNames()
        if (columns.size === 0) {
            // No messages table yet — createSchema will build the up-to-date one.
            return
        }
        if (!columns.has('invoked_at')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN invoked_at INTEGER')
        }
        // Idempotent (WHERE invoked_at IS NULL); safe to re-run if a previous attempt
        // crashed between ALTER and UPDATE before user_version was bumped.
        this.db.exec('UPDATE messages SET invoked_at = created_at WHERE invoked_at IS NULL')
        // Position index for byPosition pagination — idempotent via IF NOT EXISTS.
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_session_position
                ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC)
        `)
    }

    private migrateFromV8ToV9(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (sessionColumns.size > 0 && !sessionColumns.has('collapse_reasoning')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN collapse_reasoning INTEGER DEFAULT 0')
        }
        const msgColumns = this.getMessageColumnNames()
        if (msgColumns.size > 0 && !msgColumns.has('scheduled_at')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN scheduled_at INTEGER')
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_messages_scheduled_pending
                    ON messages(scheduled_at)
                    WHERE scheduled_at IS NOT NULL AND invoked_at IS NULL
            `)
        }
    }

    private getSessionColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMachineColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMessageColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getTeamChatColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(team_chats)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private assertRequiredTablesPresent(): void {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = REQUIRED_TABLES.filter((table) => !existing.has(table))

        if (missing.length > 0) {
            throw new Error(
                `SQLite schema is missing required tables (${missing.join(', ')}). ` +
                'Back up and rebuild the database, or run an offline migration to the expected schema version.'
            )
        }
    }

    private buildSchemaMismatchError(currentVersion: number): Error {
        const location = (this._dbPath === ':memory:' || this._dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this._dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
