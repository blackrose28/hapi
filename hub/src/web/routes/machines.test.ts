import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createMachinesRoutes } from './machines'

const allowAllCapabilities = () => 'manage' as const

function createMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'localhost',
            platform: 'darwin',
            happyCliVersion: '1.0.0'
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1,
        ...overrides
    }
}

describe('machines routes', () => {
    it('forwards Grok permission mode when spawning', async () => {
        const machine = createMachine()
        let capturedPermissionMode: string | undefined
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            spawnSession: async (
                _machineId: string,
                _directory: string,
                _agent?: string,
                _model?: string,
                _modelReasoningEffort?: string,
                _yolo?: boolean,
                _sessionType?: string,
                _worktreeName?: string,
                _resumeSessionId?: string,
                _effort?: string,
                permissionMode?: string
            ) => {
                capturedPermissionMode = permissionMode
                return { type: 'success' as const, sessionId: 'session-1' }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/spawn', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                directory: '/tmp/project',
                agent: 'grok',
                permissionMode: 'plan'
            })
        })

        expect(response.status).toBe(200)
        expect(capturedPermissionMode).toBe('plan')
    })

    it('forwards cwd to listGrokModelsForCwd for Create-session discovery', async () => {
        const machine = createMachine()
        const calls: Array<{ machineId: string; cwd: string }> = []
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listGrokModelsForCwd: async (machineId: string, cwd: string) => {
                calls.push({ machineId, cwd })
                return {
                    success: true,
                    availableModels: [{ modelId: 'grok-4.5' }],
                    currentModelId: 'grok-4.5'
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request(
            '/api/machines/machine-1/grok-models?cwd=' + encodeURIComponent('/home/user/proj')
        )

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ machineId: 'machine-1', cwd: '/home/user/proj' }])
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [{ modelId: 'grok-4.5' }],
            currentModelId: 'grok-4.5'
        })
    })

    it('filters ungranted machines and denies spawn before side effects', async () => {
        const machine = createMachine()
        let spawns = 0
        const engine = {
            getOnlineMachinesByNamespace: () => [machine],
            getMachine: () => machine,
            spawnSession: async () => { spawns++; return { type: 'success', sessionId: 's1' } }
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('organizationId', 'default')
            c.set('membershipId', 'member')
            c.set('organizationRole', 'member')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, () => null))

        expect(await (await app.request('/api/machines')).json()).toEqual({ machines: [] })
        expect((await app.request('/api/machines/machine-1/spawn', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"directory":"/repo"}'
        })).status).toBe(403)
        expect(spawns).toBe(0)
    })

    it('does not reveal a cross-organization machine', async () => {
        const machine = createMachine({ namespace: 'other' })
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('organizationId', 'default')
            c.set('membershipId', 'admin')
            c.set('organizationRole', 'admin')
            await next()
        })
        app.route('/api', createMachinesRoutes(
            () => ({ getMachine: () => machine }) as unknown as SyncEngine,
            allowAllCapabilities
        ))
        const response = await app.request('/api/machines/machine-1/codex-models')
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Machine not found' })
    })

    it('forwards a generic Claude model catalog request for an online machine', async () => {
        const machine = createMachine()
        const calls: Array<{ machineId: string; agent: string; cwd?: string }> = []
        const engine = {
            getMachine: () => machine,
            listAgentModelsForMachine: async (machineId: string, agent: string, cwd?: string) => {
                calls.push({ machineId, agent, cwd })
                return {
                    status: 'dynamic' as const,
                    models: [{ id: 'claude-custom', displayName: 'Claude Custom' }],
                    source: 'gateway:example.test/v1'
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/models?agent=claude&cwd=%2Frepo')

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ machineId: 'machine-1', agent: 'claude', cwd: '/repo' }])
        expect(await response.json()).toEqual({
            status: 'dynamic',
            models: [{ id: 'claude-custom', displayName: 'Claude Custom' }],
            source: 'gateway:example.test/v1'
        })
    })

    it.each([
        ['/api/machines/machine-1/models', 'missing'],
        ['/api/machines/machine-1/models?agent=unknown', 'invalid']
    ])('rejects a %s agent query', async (url) => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request(url)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid agent' })
    })

    it('sanitizes generic model RPC failures', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            listAgentModelsForMachine: async () => {
                throw new Error('secret-token')
            }
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/models?agent=claude')

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ error: 'Failed to list agent models' })
    })

    it('returns Codex models for an online machine', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listCodexModelsForMachine: async () => ({
                success: true,
                models: [
                    { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
                ]
            })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/codex-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            models: [
                { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
            ]
        })
    })

    it('returns 400 when /opencode-models is called without cwd', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOpencodeModelsForCwd: async () => ({ success: true, availableModels: [] })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/opencode-models')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            success: false,
            error: 'cwd query parameter is required'
        })
    })

    it('forwards cwd to listOpencodeModelsForCwd and returns availableModels', async () => {
        const machine = createMachine()
        const calls: Array<{ machineId: string; cwd: string }> = []
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOpencodeModelsForCwd: async (machineId: string, cwd: string) => {
                calls.push({ machineId, cwd })
                return {
                    success: true,
                    availableModels: [
                        { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama/EXAONE 4.5 33B Q8' }
                    ],
                    currentModelId: 'ollama/exaone:4.5-33b-q8'
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request(
            '/api/machines/machine-1/opencode-models?cwd=' + encodeURIComponent('/home/user/proj')
        )

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ machineId: 'machine-1', cwd: '/home/user/proj' }])
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama/EXAONE 4.5 33B Q8' }
            ],
            currentModelId: 'ollama/exaone:4.5-33b-q8'
        })
    })

    it('returns Cursor models for an online machine', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listCursorModelsForMachine: async () => ({
                success: true,
                availableModels: [
                    { modelId: 'composer-2.5', name: 'Composer 2.5' },
                    { modelId: 'gpt-5.5-high-fast', name: 'GPT-5.5 High Fast' }
                ],
                currentModelId: 'composer-2.5'
            })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/cursor-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'composer-2.5', name: 'Composer 2.5' },
                { modelId: 'gpt-5.5-high-fast', name: 'GPT-5.5 High Fast' }
            ],
            currentModelId: 'composer-2.5'
        })
    })

    it('returns 400 when /grok-models is called without cwd', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listGrokModelsForCwd: async () => ({ success: true, availableModels: [] })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/grok-models')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            success: false,
            error: 'cwd query parameter is required'
        })
    })

    it('forwards cwd to listGrokModelsForCwd and returns availableModels', async () => {
        const machine = createMachine()
        const calls: Array<{ machineId: string; cwd: string }> = []
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listGrokModelsForCwd: async (machineId: string, cwd: string) => {
                calls.push({ machineId, cwd })
                return {
                    success: true,
                    availableModels: [
                        { modelId: 'grok-code-fast-1', name: 'Grok Code Fast 1' }
                    ],
                    currentModelId: 'grok-code-fast-1'
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request(
            '/api/machines/machine-1/grok-models?cwd=' + encodeURIComponent('/home/user/proj')
        )

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ machineId: 'machine-1', cwd: '/home/user/proj' }])
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'grok-code-fast-1', name: 'Grok Code Fast 1' }
            ],
            currentModelId: 'grok-code-fast-1'
        })
    })

    it('forwards resumeSessionId from spawn requests', async () => {
        const machine = createMachine()
        const calls: Array<{ resumeSessionId?: string }> = []
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            spawnSession: async (
                _machineId: string,
                _directory: string,
                _agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
                _model?: string,
                _modelReasoningEffort?: string,
                _yolo?: boolean,
                _sessionType?: 'simple' | 'worktree',
                _worktreeName?: string,
                resumeSessionId?: string
            ) => {
                calls.push({ resumeSessionId })
                return { type: 'success', sessionId: 'session-1' }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('organizationId', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine, allowAllCapabilities))

        const response = await app.request('/api/machines/machine-1/spawn', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                directory: '/repo',
                agent: 'codex',
                resumeSessionId: '019ed35e-db26-7770-abb3-1c7ee3c92f52'
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'session-1' })
        expect(calls).toEqual([{ resumeSessionId: '019ed35e-db26-7770-abb3-1c7ee3c92f52' }])
    })

=======
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/cursor-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'composer-2.5', name: 'Composer 2.5' },
                { modelId: 'gpt-5.5-high-fast', name: 'GPT-5.5 High Fast' }
            ],
            currentModelId: 'composer-2.5'
        })
    })
>>>>>>> 1d03f186 (feat(cursor): support model selection (#684))
})
