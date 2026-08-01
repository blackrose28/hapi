import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { execFile, type ExecFileOptions } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT = 10_000
const REPOSITORY_SCAN_DEPTH = 3

type EditorGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
type RepositoryState = 'ready' | 'notRepository' | 'repoOutsideRoot' | 'detached' | 'initial'

type CommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

type EditorGitRepository = {
    root: string
    name: string
    branch: string | null
    state: RepositoryState
    gitDir?: string
}

type EditorGitFile = {
    fileName: string
    filePath: string
    fullPath: string
    status: EditorGitFileStatus
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

type EditorGitStatusResponse = {
    success: boolean
    state: RepositoryState
    repositories: EditorGitRepository[]
    activeRepository?: EditorGitRepository
    branch?: string | null
    upstream?: string
    ahead?: number
    behind?: number
    stagedFiles: EditorGitFile[]
    unstagedFiles: EditorGitFile[]
    totalStaged: number
    totalUnstaged: number
    error?: string
}

type EditorGitPathRequest = { path?: string; repoRoot?: string }
type EditorGitFileRequest = EditorGitPathRequest & { filePath?: string; staged?: boolean }
type EditorGitCommitRequest = EditorGitPathRequest & { message?: string }
type EditorGitBranch = {
    name: string
    isCurrent: boolean
}

type EditorGitListBranchesResponse = {
    success: boolean
    branches: EditorGitBranch[]
    currentBranch: string | null
    error?: string
}

type EditorGitCheckoutRequest = EditorGitPathRequest & { branch?: string }
type EditorGitCreateBranchRequest = EditorGitPathRequest & { branch?: string }
type EditorGitStashEntry = {
    index: number
    branch: string
    message: string
}

type EditorGitStashListResponse = {
    success: boolean
    stashes: EditorGitStashEntry[]
    error?: string
}

type EditorGitDiscardRequest = EditorGitPathRequest & { filePath?: string }



const execGit = execFileAsync as (file: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>

function rpcError<T extends object = object>(error: string, extra?: T): { success: false; error: string } & T {
    return { success: false, error, ...(extra ?? {} as T) }
}

function isWithinRoot(absolutePath: string, root: string): boolean {
    const rel = relative(root, absolutePath)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function normalizeRoot(rootDir: string): Promise<string> {
    const resolvedRoot = resolve(rootDir)
    try {
        return await realpath(resolvedRoot)
    } catch {
        return resolvedRoot
    }
}

async function resolveInsideRoot(rawPath: string | undefined, rootDir: string): Promise<{ path: string; root: string; error?: string }> {
    const root = await normalizeRoot(rootDir)
    const target = resolve(root, rawPath && rawPath.trim() ? rawPath : root)
    let resolvedTarget = target
    try {
        resolvedTarget = await realpath(target)
    } catch {
        resolvedTarget = target
    }
    if (!isWithinRoot(resolvedTarget, root)) {
        return { path: resolvedTarget, root, error: 'Path outside editor root' }
    }
    return { path: resolvedTarget, root }
}

async function runGit(args: string[], cwd: string, timeout = DEFAULT_TIMEOUT): Promise<CommandResponse> {
    try {
        const { stdout, stderr } = await execGit('git', args, {
            cwd,
            timeout,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024
        })
        return { success: true, stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 }
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer; code?: number | string; killed?: boolean }
        return rpcError(execError.killed ? 'Command timed out' : execError.message || 'Git command failed', {
            stdout: execError.stdout ? execError.stdout.toString() : '',
            stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Git command failed',
            exitCode: typeof execError.code === 'number' ? execError.code : execError.killed ? -1 : 1
        })
    }
}

async function resolveRepository(projectPath: string, editorRoot: string, requestedRepoRoot?: string): Promise<{
    state: RepositoryState
    repoRoot?: string
    gitDir?: string
    root: string
    error?: string
}> {
    const root = await normalizeRoot(editorRoot)
    if (requestedRepoRoot?.trim()) {
        const requested = resolve(root, requestedRepoRoot.trim())
        let realRequested = requested
        try {
            realRequested = await realpath(requested)
        } catch {
            realRequested = requested
        }
        if (!isWithinRoot(realRequested, root)) {
            return { state: 'repoOutsideRoot', root, error: 'Repository root outside editor root' }
        }
        const topLevel = await runGit(['rev-parse', '--show-toplevel'], realRequested, 5_000)
        if (!topLevel.success) {
            return { state: 'notRepository', root, error: 'No Git repository found' }
        }
        const gitDir = await runGit(['rev-parse', '--git-dir'], realRequested, 5_000)
        return { state: 'ready', repoRoot: realRequested, gitDir: gitDir.stdout?.trim(), root }
    }

    const topLevel = await runGit(['rev-parse', '--show-toplevel'], projectPath, 5_000)
    if (!topLevel.success) {
        return { state: 'notRepository', root }
    }
    const gitDir = await runGit(['rev-parse', '--git-dir'], projectPath, 5_000)
    const repoRoot = topLevel.stdout?.trim()
    if (!repoRoot) {
        return { state: 'notRepository', root }
    }
    let realRepoRoot = repoRoot
    try {
        realRepoRoot = await realpath(repoRoot)
    } catch {
        realRepoRoot = repoRoot
    }
    if (!isWithinRoot(realRepoRoot, root)) {
        return {
            state: 'repoOutsideRoot',
            repoRoot: realRepoRoot,
            gitDir: gitDir.stdout?.trim(),
            root,
            error: 'Repository root outside editor root'
        }
    }
    return { state: 'ready', repoRoot: realRepoRoot, gitDir: gitDir.stdout?.trim(), root }
}

function splitNul(output: string): string[] {
    return output.split('\0').filter((entry) => entry.length > 0)
}

function statusFromChar(value: string): EditorGitFileStatus {
    if (value === 'A') return 'added'
    if (value === 'D') return 'deleted'
    if (value === 'R' || value === 'C') return 'renamed'
    if (value === 'U') return 'conflicted'
    return 'modified'
}

function splitFilePath(fullPath: string): { fileName: string; filePath: string } {
    const parts = fullPath.split('/')
    const fileName = parts.pop() || fullPath
    return { fileName, filePath: parts.join('/') }
}

function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
    const result = new Map<string, { added: number; removed: number }>()
    for (const line of output.split('\n')) {
        if (!line.trim()) continue
        const [addedRaw, removedRaw, file] = line.split('\t')
        if (!file) continue
        result.set(file, {
            added: addedRaw === '-' ? 0 : Number.parseInt(addedRaw, 10),
            removed: removedRaw === '-' ? 0 : Number.parseInt(removedRaw, 10)
        })
    }
    return result
}

function parseStatusPorcelainZ(
    output: string,
    unstagedStats: Map<string, { added: number; removed: number }>,
    stagedStats: Map<string, { added: number; removed: number }>
): Pick<EditorGitStatusResponse, 'branch' | 'upstream' | 'ahead' | 'behind' | 'stagedFiles' | 'unstagedFiles'> {
    const entries = splitNul(output)
    const stagedFiles: EditorGitFile[] = []
    const unstagedFiles: EditorGitFile[] = []
    let branch: string | null | undefined
    let upstream: string | undefined
    let ahead: number | undefined
    let behind: number | undefined

    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        if (entry.startsWith('# branch.head ')) {
            const value = entry.slice('# branch.head '.length)
            branch = value === '(detached)' || value === '(initial)' ? null : value
            continue
        }
        if (entry.startsWith('# branch.upstream ')) {
            upstream = entry.slice('# branch.upstream '.length)
            continue
        }
        if (entry.startsWith('# branch.ab ')) {
            const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(entry)
            if (match) {
                ahead = Number.parseInt(match[1], 10)
                behind = Number.parseInt(match[2], 10)
            }
            continue
        }
        if (entry.startsWith('? ')) {
            const fullPath = entry.slice(2)
            const split = splitFilePath(fullPath)
            unstagedFiles.push({
                ...split,
                fullPath,
                status: 'untracked',
                isStaged: false,
                linesAdded: 0,
                linesRemoved: 0
            })
            continue
        }
        if (entry.startsWith('1 ')) {
            const parts = entry.split(' ')
            const xy = parts[1] ?? '  '
            const fullPath = parts.slice(8).join(' ')
            if (!fullPath) continue
            const split = splitFilePath(fullPath)
            if (xy[0] && xy[0] !== '.' && xy[0] !== ' ') {
                const stats = stagedStats.get(fullPath) ?? { added: 0, removed: 0 }
                stagedFiles.push({ ...split, fullPath, status: statusFromChar(xy[0]), isStaged: true, linesAdded: stats.added, linesRemoved: stats.removed })
            }
            if (xy[1] && xy[1] !== '.' && xy[1] !== ' ') {
                const stats = unstagedStats.get(fullPath) ?? { added: 0, removed: 0 }
                unstagedFiles.push({ ...split, fullPath, status: statusFromChar(xy[1]), isStaged: false, linesAdded: stats.added, linesRemoved: stats.removed })
            }
            continue
        }
        if (entry.startsWith('2 ')) {
            const nextPath = entries[index + 1]
            const parts = entry.split(' ')
            const xy = parts[1] ?? '  '
            const fullPath = parts.slice(9).join(' ')
            const oldPath = nextPath && !nextPath.startsWith('# ') ? nextPath : undefined
            if (oldPath) index += 1
            if (!fullPath) continue
            const split = splitFilePath(fullPath)
            const stats = stagedStats.get(fullPath) ?? unstagedStats.get(fullPath) ?? { added: 0, removed: 0 }
            const file = { ...split, fullPath, oldPath, status: 'renamed' as const, linesAdded: stats.added, linesRemoved: stats.removed }
            if (xy[0] && xy[0] !== '.' && xy[0] !== ' ') stagedFiles.push({ ...file, isStaged: true })
            if (xy[1] && xy[1] !== '.' && xy[1] !== ' ') unstagedFiles.push({ ...file, isStaged: false })
        }
    }
    return { branch, upstream, ahead, behind, stagedFiles, unstagedFiles }
}

async function getRepositorySummary(repoRoot: string, state: RepositoryState, gitDir?: string): Promise<EditorGitRepository> {
    const branchResult = await runGit(['branch', '--show-current'], repoRoot, 5_000)
    const branch = branchResult.success && branchResult.stdout?.trim() ? branchResult.stdout.trim() : null
    return { root: repoRoot, name: basename(repoRoot) || repoRoot, branch, state, gitDir }
}

async function scanNestedRepositories(projectPath: string, editorRoot: string, primaryRoot?: string): Promise<EditorGitRepository[]> {
    const root = await normalizeRoot(editorRoot)
    const found = new Map<string, EditorGitRepository>()
    if (primaryRoot) {
        found.set(primaryRoot, await getRepositorySummary(primaryRoot, 'ready'))
    }

    async function scan(dir: string, depth: number): Promise<void> {
        if (depth > REPOSITORY_SCAN_DEPTH || !isWithinRoot(dir, root)) return
        let entries: Dirent<string>[]
        try {
            entries = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        const hasGit = entries.some((entry) => entry.name === '.git')
        if (hasGit) {
            const resolved = await resolveRepository(dir, editorRoot)
            if (resolved.repoRoot && !found.has(resolved.repoRoot)) {
                found.set(resolved.repoRoot, await getRepositorySummary(resolved.repoRoot, resolved.state, resolved.gitDir))
            }
        }
        const skip = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache'])
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isDirectory() || skip.has(entry.name)) return
            await scan(join(dir, entry.name), depth + 1)
        }))
    }

    await scan(projectPath, 0)
    return [...found.values()].sort((a, b) => a.root.localeCompare(b.root))
}

async function getStatus(path: string, editorRoot: string, requestedRepoRoot?: string): Promise<EditorGitStatusResponse> {
    const resolved = await resolveRepository(path, editorRoot, requestedRepoRoot)
    if (resolved.state === 'notRepository') {
        return {
            success: true,
            state: 'notRepository',
            repositories: [],
            stagedFiles: [],
            unstagedFiles: [],
            totalStaged: 0,
            totalUnstaged: 0
        }
    }
    if (!resolved.repoRoot || resolved.state === 'repoOutsideRoot') {
        return {
            success: false,
            state: 'repoOutsideRoot',
            repositories: [],
            stagedFiles: [],
            unstagedFiles: [],
            totalStaged: 0,
            totalUnstaged: 0,
            error: resolved.error ?? 'Repository root outside editor root'
        }
    }

    const [statusResult, unstagedNumstat, stagedNumstat] = await Promise.all([
        runGit(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], resolved.repoRoot),
        runGit(['diff', '--numstat'], resolved.repoRoot),
        runGit(['diff', '--cached', '--numstat'], resolved.repoRoot)
    ])
    if (!statusResult.success) {
        return {
            success: false,
            state: 'ready',
            repositories: [],
            stagedFiles: [],
            unstagedFiles: [],
            totalStaged: 0,
            totalUnstaged: 0,
            error: statusResult.error ?? statusResult.stderr ?? 'Git status failed'
        }
    }
    const parsed = parseStatusPorcelainZ(statusResult.stdout ?? '', parseNumstat(unstagedNumstat.stdout ?? ''), parseNumstat(stagedNumstat.stdout ?? ''))
    const state: RepositoryState = parsed.branch === null ? 'detached' : 'ready'
    const activeRepository = await getRepositorySummary(resolved.repoRoot, state, resolved.gitDir)
    const repositories = await scanNestedRepositories(path, editorRoot, resolved.repoRoot)
    return {
        success: true,
        state,
        repositories: repositories.length ? repositories : [activeRepository],
        activeRepository,
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        stagedFiles: parsed.stagedFiles,
        unstagedFiles: parsed.unstagedFiles,
        totalStaged: parsed.stagedFiles.length,
        totalUnstaged: parsed.unstagedFiles.length
    }
}

async function resolveCommandRepo(data: EditorGitPathRequest, editorRoot: string): Promise<{ repoRoot?: string; error?: string; state?: RepositoryState }> {
    const resolvedPath = await resolveInsideRoot(data.path, editorRoot)
    if (resolvedPath.error) return { error: resolvedPath.error }
    const repo = await resolveRepository(resolvedPath.path, editorRoot, data.repoRoot)
    if (!repo.repoRoot) return { error: repo.error ?? 'No Git repository found', state: repo.state }
    return { repoRoot: repo.repoRoot, state: repo.state }
}

function validateRelativeGitPath(filePath: string | undefined): string | null {
    if (!filePath?.trim()) return null
    const value = filePath.trim()
    if (isAbsolute(value) || value.split(/[\\/]+/).includes('..')) return null
    return value
}

export function registerEditorGitRpcHandlers(rpcHandlerManager: RpcHandlerManager, editorRoot: string): void {
    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-status-v2', async (data) => {
        const resolvedPath = await resolveInsideRoot(data?.path, editorRoot)
        if (resolvedPath.error) return rpcError(resolvedPath.error)
        return await getStatus(resolvedPath.path, editorRoot, data?.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitFileRequest>('editor-git-diff-file', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        const filePath = validateRelativeGitPath(data?.filePath)
        if (!filePath) return rpcError('Invalid file path')
        const args = data?.staged ? ['diff', '--cached', '--no-ext-diff', '--', filePath] : ['diff', '--no-ext-diff', '--', filePath]
        return await runGit(args, repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitFileRequest>('editor-git-stage-file', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        const filePath = validateRelativeGitPath(data?.filePath)
        if (!filePath) return rpcError('Invalid file path')
        return await runGit(['add', '--', filePath], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitFileRequest>('editor-git-unstage-file', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        const filePath = validateRelativeGitPath(data?.filePath)
        if (!filePath) return rpcError('Invalid file path')
        return await runGit(['restore', '--staged', '--', filePath], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-stage-all', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['add', '-A'], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-unstage-all', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['reset', 'HEAD', '--'], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitCommitRequest>('editor-git-commit', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        const message = data?.message?.trim()
        if (!message) return rpcError('Commit message is required')
        return await runGit(['commit', '-m', message], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-pull', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['pull', '--ff-only'], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-push', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['push'], repo.repoRoot)
    })
    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-list-branches', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return { success: false, branches: [], currentBranch: null, error: repo.error ?? 'No Git repository found' }
        
        const result = await runGit(['branch', '--list', '--no-color'], repo.repoRoot)
        if (!result.success) return { success: false, branches: [], currentBranch: null, error: result.error ?? result.stderr ?? 'Failed to list branches' }
        
        const lines = (result.stdout ?? '').split('\n').map(l => l.trim()).filter(Boolean)
        const branches: EditorGitBranch[] = lines.map(line => ({
            name: line.replace(/^\*\s+/, ''),
            isCurrent: line.startsWith('*')
        }))
        const currentBranch = branches.find(b => b.isCurrent)?.name ?? null
        
        return { success: true, branches, currentBranch }
    })

    rpcHandlerManager.registerHandler<EditorGitCheckoutRequest>('editor-git-checkout', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        if (!data?.branch?.trim()) return rpcError('Branch name is required')
        return await runGit(['checkout', data.branch.trim()], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitCreateBranchRequest>('editor-git-create-branch', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        if (!data?.branch?.trim()) return rpcError('Branch name is required')
        return await runGit(['checkout', '-b', data.branch.trim()], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-fetch', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['fetch', '--all', '--prune'], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitDiscardRequest>('editor-git-discard-file', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        const filePath = validateRelativeGitPath(data?.filePath)
        if (!filePath) return rpcError('Invalid file path')
        return await runGit(['checkout', '--', filePath], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitDiscardRequest>('editor-git-discard-all', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['checkout', '--', '.'], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-stash-list', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return { success: false, stashes: [], error: repo.error ?? 'No Git repository found' }
        
        const result = await runGit(['stash', 'list', '--pretty=format:%gd|%gs'], repo.repoRoot)
        if (!result.success) return { success: false, stashes: [], error: result.error ?? result.stderr ?? 'Failed to list stashes' }
        
        const stashes: EditorGitStashEntry[] = (result.stdout ?? '').split('\n').filter(Boolean).map((line, idx) => {
            const [ref, ...msgParts] = line.split('|')
            const message = msgParts.join('|')
            // Extract branch from message like "WIP on main: abc123"
            const branchMatch = /^WIP on (S+)/.exec(message)
            return {
                index: idx,
                branch: branchMatch?.[1] ?? 'unknown',
                message: message || ref || 'Untitled stash'
            }
        })
        
        return { success: true, stashes }
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-stash-push', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['stash', 'push', '--include-untracked', '-m', 'HAPI editor stash'], repo.repoRoot)
    })

    rpcHandlerManager.registerHandler<EditorGitPathRequest>('editor-git-stash-pop', async (data) => {
        const repo = await resolveCommandRepo(data ?? {}, editorRoot)
        if (!repo.repoRoot) return rpcError(repo.error ?? 'No Git repository found', { state: repo.state })
        return await runGit(['stash', 'pop'], repo.repoRoot)
    })

}
