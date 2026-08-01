import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerEditorRpcHandlers } from './editorRpc'

async function createTempDir(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

async function request(rpc: RpcHandlerManager, method: string, params: unknown): Promise<any> {
    const response = await rpc.handleRequest({
        method: `machine-test:${method}`,
        params: JSON.stringify(params)
    })
    return JSON.parse(response)
}

async function runGit(args: string[], cwd: string): Promise<void> {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('git', args, { cwd })
}

async function initRepo(path: string): Promise<void> {
    await runGit(['init'], path)
    await runGit(['config', 'user.email', 'hapi@example.com'], path)
    await runGit(['config', 'user.name', 'Hapi Test'], path)
}

describe('editor RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        rootDir = await createTempDir('hapi-editor-rpc')
        await mkdir(join(rootDir, 'src'), { recursive: true })
        await mkdir(join(rootDir, '.hidden'), { recursive: true })
        await writeFile(join(rootDir, 'README.md'), '# hello')
        await writeFile(join(rootDir, 'src', 'index.ts'), 'console.log("ok")')
        await writeFile(join(rootDir, '.secret'), 'hidden')

        rpc = new RpcHandlerManager({ scopePrefix: 'machine-test' })
        registerEditorRpcHandlers(rpc, rootDir)
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
    })

    it('lists editor directory entries from a machine scoped handler', async () => {
        const parsed = await request(rpc, 'editor-list-directory', { path: rootDir }) as {
            success: boolean
            entries?: Array<{ name: string; type: string; size?: number; modified?: number }>
        }

        expect(parsed.success).toBe(true)
        expect(parsed.entries?.map((entry) => entry.name)).toEqual(['src', 'README.md'])
        expect(parsed.entries?.[0]).toMatchObject({ name: 'src', type: 'directory' })
        expect(parsed.entries?.[1]).toMatchObject({ name: 'README.md', type: 'file' })
        expect(parsed.entries?.[1].size).toBeGreaterThan(0)
        expect(parsed.entries?.[1].modified).toEqual(expect.any(Number))
    })

    it('reads a text file as base64 and reports size', async () => {
        const parsed = await request(rpc, 'editor-read-file', { path: join(rootDir, 'README.md') }) as {
            success: boolean
            content?: string
            size?: number
        }

        expect(parsed).toEqual({
            success: true,
            content: Buffer.from('# hello').toString('base64'),
            size: 7
        })
    })

    it('writes an existing text file inside the editor root', async () => {
        const filePath = join(rootDir, 'README.md')

        const parsed = await request(rpc, 'editor-write-file', {
            path: filePath,
            content: '# updated'
        }) as { success: boolean; path?: string; size?: number }

        expect(parsed).toEqual({
            success: true,
            path: filePath,
            size: Buffer.byteLength('# updated')
        })
        await expect(readFile(filePath, 'utf8')).resolves.toBe('# updated')
    })

    it('creates nested text files without overwriting existing files', async () => {
        const filePath = join(rootDir, 'src', 'components', 'Button.tsx')

        const parsed = await request(rpc, 'editor-create-file', {
            path: filePath,
            content: 'export function Button() {}'
        }) as { success: boolean; path?: string; size?: number }

        expect(parsed).toEqual({
            success: true,
            path: filePath,
            size: Buffer.byteLength('export function Button() {}')
        })
        await expect(readFile(filePath, 'utf8')).resolves.toBe('export function Button() {}')
        await expect(request(rpc, 'editor-create-file', { path: filePath, content: '' })).resolves.toMatchObject({
            success: false,
            error: 'File already exists'
        })
    })

    it('deletes existing files and directories inside the editor root', async () => {
        const filePath = join(rootDir, 'src', 'delete-me.ts')
        const dirPath = join(rootDir, 'src', 'delete-dir')
        await writeFile(filePath, 'remove me')
        await mkdir(dirPath)
        await writeFile(join(dirPath, 'nested.ts'), 'remove me too')

        const parsed = await request(rpc, 'editor-delete-file', { path: filePath }) as { success: boolean; path?: string }
        const dirParsed = await request(rpc, 'editor-delete-file', { path: dirPath }) as { success: boolean; path?: string }

        expect(parsed).toEqual({
            success: true,
            path: filePath
        })
        expect(dirParsed).toEqual({
            success: true,
            path: dirPath
        })
        await expect(stat(filePath)).rejects.toThrow()
        await expect(stat(dirPath)).rejects.toThrow()
    })

    it('rejects binary files and paths outside the editor root', async () => {
        await writeFile(join(rootDir, 'binary.bin'), Buffer.from([0, 1, 2, 3]))

        await expect(request(rpc, 'editor-read-file', { path: join(rootDir, 'binary.bin') })).resolves.toMatchObject({
            success: false,
            error: 'Cannot read binary file'
        })
        await expect(request(rpc, 'editor-read-file', { path: resolve(rootDir, '..', 'outside.txt') })).resolves.toMatchObject({
            success: false,
            error: 'Path outside editor root'
        })
        await expect(request(rpc, 'editor-write-file', { path: resolve(rootDir, '..', 'outside.txt'), content: 'nope' })).resolves.toMatchObject({
            success: false,
            error: 'Path outside editor root'
        })
        await expect(request(rpc, 'editor-create-file', { path: resolve(rootDir, '..', 'outside.txt'), content: 'nope' })).resolves.toMatchObject({
            success: false,
            error: 'Path outside editor root'
        })
        await expect(request(rpc, 'editor-delete-file', { path: resolve(rootDir, '..', 'outside.txt') })).resolves.toMatchObject({
            success: false,
            error: 'Path outside editor root'
        })
    })

    it('lists projects with git repositories first', async () => {
        await mkdir(join(rootDir, '.git'), { recursive: true })
        await mkdir(join(rootDir, 'child-git', '.git'), { recursive: true })
        await mkdir(join(rootDir, 'child-plain'), { recursive: true })

        const parsed = await request(rpc, 'editor-list-projects', {}) as {
            success: boolean
            projects?: Array<{ path: string; name: string; hasGit: boolean }>
        }

        expect(parsed.success).toBe(true)
        expect(parsed.projects).toEqual(expect.arrayContaining([
            { path: rootDir, name: rootDir.split('/').pop(), hasGit: true },
            { path: join(rootDir, 'child-git'), name: 'child-git', hasGit: true },
            { path: join(rootDir, 'child-plain'), name: 'child-plain', hasGit: false }
        ]))
        const gitProjectIndex = parsed.projects?.findIndex((project) => project.name === 'child-git') ?? -1
        const plainProjectIndex = parsed.projects?.findIndex((project) => project.name === 'child-plain') ?? -1
        expect(gitProjectIndex).toBeGreaterThanOrEqual(0)
        expect(plainProjectIndex).toBeGreaterThan(gitProjectIndex)
    })

    it('reports notRepository for a folder without git metadata', async () => {
        const parsed = await request(rpc, 'editor-git-status-v2', { path: rootDir }) as {
            success: boolean
            state?: string
            repositories?: unknown[]
        }

        expect(parsed).toMatchObject({ success: true, state: 'notRepository', repositories: [] })
    })

    it('discovers a repository from a nested project path and reports changed files', async () => {
        await initRepo(rootDir)
        await runGit(['add', 'README.md'], rootDir)
        await runGit(['commit', '-m', 'initial'], rootDir)
        await writeFile(join(rootDir, 'README.md'), '# changed')
        await writeFile(join(rootDir, 'space name.txt'), 'hello')

        const parsed = await request(rpc, 'editor-git-status-v2', { path: join(rootDir, 'src') }) as {
            success: boolean
            state?: string
            activeRepository?: { root: string; branch: string | null }
            unstagedFiles?: Array<{ fullPath: string; status: string }>
        }

        expect(parsed.success).toBe(true)
        expect(parsed.state).toBe('ready')
        expect(parsed.activeRepository?.root).toBe(rootDir)
        expect(parsed.unstagedFiles).toEqual(expect.arrayContaining([
            expect.objectContaining({ fullPath: 'README.md', status: 'modified' }),
            expect.objectContaining({ fullPath: 'space name.txt', status: 'untracked' })
        ]))
    })

    it('rejects repository roots outside the editor root', async () => {
        const outerDir = await createTempDir('hapi-editor-rpc-outer')
        const editorRoot = join(outerDir, 'nested')
        await mkdir(editorRoot, { recursive: true })
        await initRepo(outerDir)
        const nestedRpc = new RpcHandlerManager({ scopePrefix: 'machine-test' })
        registerEditorRpcHandlers(nestedRpc, editorRoot)

        try {
            const parsed = await request(nestedRpc, 'editor-git-status-v2', { path: editorRoot }) as {
                success: boolean
                state?: string
                error?: string
            }

            expect(parsed).toMatchObject({ success: false, state: 'repoOutsideRoot' })
            expect(parsed.error).toContain('outside editor root')
        } finally {
            await rm(outerDir, { recursive: true, force: true })
        }
    })

    it('stages, unstages, and commits files inside the active repository', async () => {
        await initRepo(rootDir)
        await writeFile(join(rootDir, 'tracked.txt'), 'one')
        await runGit(['add', 'tracked.txt'], rootDir)
        await runGit(['commit', '-m', 'initial'], rootDir)
        await writeFile(join(rootDir, 'tracked.txt'), 'two')

        await expect(request(rpc, 'editor-git-stage-file', { path: rootDir, filePath: 'tracked.txt' })).resolves.toMatchObject({ success: true })
        let status = await request(rpc, 'editor-git-status-v2', { path: rootDir }) as { stagedFiles?: Array<{ fullPath: string }> }
        expect(status.stagedFiles).toEqual(expect.arrayContaining([expect.objectContaining({ fullPath: 'tracked.txt' })]))

        await expect(request(rpc, 'editor-git-unstage-file', { path: rootDir, filePath: 'tracked.txt' })).resolves.toMatchObject({ success: true })
        status = await request(rpc, 'editor-git-status-v2', { path: rootDir }) as { stagedFiles?: Array<{ fullPath: string }> }
        expect(status.stagedFiles).toEqual([])

        await expect(request(rpc, 'editor-git-stage-all', { path: rootDir })).resolves.toMatchObject({ success: true })
        await expect(request(rpc, 'editor-git-commit', { path: rootDir, message: 'update tracked' })).resolves.toMatchObject({ success: true })
        const log = await request(rpc, 'editor-git-status-v2', { path: rootDir }) as { totalStaged?: number; totalUnstaged?: number }
        expect(log.totalStaged).toBe(0)
        expect(log.totalUnstaged).toBe(0)
    })

    it('requires a commit message and rejects unsafe git file paths', async () => {
        await initRepo(rootDir)
        await expect(request(rpc, 'editor-git-commit', { path: rootDir, message: '   ' })).resolves.toMatchObject({
            success: false,
            error: 'Commit message is required'
        })
        await expect(request(rpc, 'editor-git-stage-file', { path: rootDir, filePath: '../outside.txt' })).resolves.toMatchObject({
            success: false,
            error: 'Invalid file path'
        })
    })

    it('reads a raw image file as base64', async () => {
        const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        await writeFile(join(rootDir, 'test.png'), pngBytes)

        const parsed = await request(rpc, 'editor-read-file-raw', { path: join(rootDir, 'test.png') }) as {
            success: boolean
            data?: string
            mimeType?: string
            size?: number
            error?: string
        }

        expect(parsed.success).toBe(true)
        expect(parsed.data).toBe(pngBytes.toString('base64'))
        expect(parsed.mimeType).toBe('image/png')
        expect(parsed.size).toBe(pngBytes.length)
    })

    it('rejects raw file outside editor root', async () => {
        await expect(request(rpc, 'editor-read-file-raw', { path: resolve(rootDir, '..', 'outside.png') })).resolves.toMatchObject({
            success: false,
            error: 'Path outside editor root'
        })
    })

    it('rejects raw file with unsupported extension', async () => {
        await writeFile(join(rootDir, 'doc.txt'), 'hello')
        await expect(request(rpc, 'editor-read-file-raw', { path: join(rootDir, 'doc.txt') })).resolves.toMatchObject({
            success: false,
            error: 'Unsupported file type'
        })
    })

    it('rejects raw file that is a directory', async () => {
        await mkdir(join(rootDir, 'images.png'), { recursive: true })
        await expect(request(rpc, 'editor-read-file-raw', { path: join(rootDir, 'images.png') })).resolves.toMatchObject({
            success: false,
            error: 'Path is not a file'
        })
    })

    it('detects MIME type for all supported image extensions', async () => {
        const testBytes = Buffer.from('fake-image-data')
        const cases: Array<[string, string]> = [
            ['image.png', 'image/png'],
            ['photo.jpg', 'image/jpeg'],
            ['photo.jpeg', 'image/jpeg'],
            ['anim.gif', 'image/gif'],
            ['logo.svg', 'image/svg+xml'],
            ['img.webp', 'image/webp'],
        ]

        for (const [filename, expectedMime] of cases) {
            await writeFile(join(rootDir, filename), testBytes)
            const parsed = await request(rpc, 'editor-read-file-raw', { path: join(rootDir, filename) }) as {
                success: boolean
                mimeType?: string
            }
            expect(parsed.success).toBe(true)
            expect(parsed.mimeType).toBe(expectedMime)
        }
    })
})
