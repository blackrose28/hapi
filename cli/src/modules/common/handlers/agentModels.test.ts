import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { CLAUDE_MODEL_PRESETS } from '@hapi/protocol'
import { registerAgentModelHandlers } from './agentModels'

describe('agent model RPC handler', () => {
    it('registers a generic handler and returns Claude fallback models', async () => {
        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerAgentModelHandlers(rpc, '/repo')

        const response = await rpc.handleRequest({
            method: 'session-test:listAgentModels',
            params: JSON.stringify({ agent: 'claude' })
        })
        const result = JSON.parse(response) as {
            status: string
            models: Array<{ id: string }>
        }

        expect(result.status).toBe('unsupported')
        expect(result.models.map((model) => model.id)).toEqual(CLAUDE_MODEL_PRESETS)
    })

    it('does not dispatch an invalid flavor', async () => {
        const rpc = new RpcHandlerManager({ scopePrefix: 'machine-test' })
        registerAgentModelHandlers(rpc, '/repo')

        const response = await rpc.handleRequest({
            method: 'machine-test:listAgentModels',
            params: JSON.stringify({ agent: 'unknown' })
        })

        expect(JSON.parse(response)).toEqual({
            status: 'unsupported',
            models: [],
            source: 'static'
        })
    })

    it('uses the requested project directory for machine-scoped discovery', async () => {
        const root = await mkdtemp(join(tmpdir(), 'hapi-agent-model-handler-'))
        const selectedProject = join(root, 'selected')
        const configDir = join(root, 'config')
        await mkdir(join(selectedProject, '.claude'), { recursive: true })
        await mkdir(configDir, { recursive: true })
        await writeFile(join(selectedProject, '.claude', 'settings.json'), JSON.stringify({
            availableModels: []
        }))
        const rpc = new RpcHandlerManager({ scopePrefix: 'machine-test' })
        registerAgentModelHandlers(rpc, root)

        const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
        const originalFlag = process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY
        process.env.CLAUDE_CONFIG_DIR = configDir
        delete process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY
        try {
            const response = await rpc.handleRequest({
                method: 'machine-test:listAgentModels',
                params: JSON.stringify({ agent: 'claude', cwd: selectedProject })
            })
            expect(JSON.parse(response)).toMatchObject({ status: 'unsupported', models: [] })
        } finally {
            if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
            else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
            if (originalFlag === undefined) delete process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY
            else process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = originalFlag
            await rm(root, { recursive: true, force: true })
        }
    })
})
