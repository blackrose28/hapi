import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_MODEL_PRESETS } from '@hapi/protocol'
import { listAgentModels } from './catalog'

const validEnv = {
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    ANTHROPIC_BASE_URL: 'https://gateway.example/v1',
    ANTHROPIC_API_KEY: 'test-secret',
    CLAUDE_CONFIG_DIR: join(tmpdir(), 'hapi-test-no-claude-settings')
}

describe('Claude gateway discovery gates', () => {
    it.each([
        ['missing discovery flag', { ...validEnv, CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: undefined }],
        ['nonessential traffic disabled', { ...validEnv, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }],
        ['cloud provider selected', { ...validEnv, CLAUDE_CODE_USE_BEDROCK: 'TrUe' }],
        ['missing base URL', { ...validEnv, ANTHROPIC_BASE_URL: undefined }],
        ['Anthropic first-party URL', { ...validEnv, ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }],
        ['missing static credential', {
            ...validEnv,
            ANTHROPIC_API_KEY: undefined,
            CLAUDE_CODE_API_KEY_HELPER: '/usr/local/bin/get-key'
        }]
    ])('returns fallback without HTTP for %s', async (_name, env) => {
        const httpGet = vi.fn()

        const result = await listAgentModels('claude', {
            cwd: '/repo',
            env,
            managedSettingsPaths: [],
            httpGet
        })

        expect(result.status).toBe('unsupported')
        expect(result.models.map((model) => model.id)).toEqual(CLAUDE_MODEL_PRESETS)
        expect(httpGet).not.toHaveBeenCalled()
    })

    it('returns fallback for agents without a catalog adapter', async () => {
        const httpGet = vi.fn()

        const result = await listAgentModels('gemini', {
            cwd: '/repo',
            env: validEnv,
            managedSettingsPaths: [],
            httpGet
        })

        expect(result.status).toBe('unsupported')
        expect(result.models).toEqual([])
        expect(httpGet).not.toHaveBeenCalled()
    })
})

describe('Claude gateway HTTP discovery', () => {
    it('uses bearer auth, safe custom headers, the /v1 models endpoint, and normalizes models', async () => {
        const httpGet = vi.fn().mockResolvedValue({
            status: 200,
            data: {
                data: [
                    { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
                    { id: 'claude-sonnet-4-5', display_name: 'Duplicate' },
                    { id: 'anthropic/claude-opus', displayName: 'Gateway Opus' },
                    { id: 'gpt-5', display_name: 'Wrong provider' },
                    { id: '', display_name: 'Invalid' }
                ]
            }
        })

        const result = await listAgentModels('claude', {
            cwd: '/repo',
            env: {
                ...validEnv,
                ANTHROPIC_AUTH_TOKEN: 'bearer-secret',
                ANTHROPIC_CUSTOM_HEADERS: [
                    'X-Trace-Id: trace-123',
                    'X-Unsafe:\tvalue',
                    'Authorization: attacker-value',
                    'Host: attacker.example',
                    'X-Bad: value\u0007'
                ].join('\n')
            },
            managedSettingsPaths: [],
            httpGet
        })

        expect(httpGet).toHaveBeenCalledTimes(1)
        const [url, config] = httpGet.mock.calls[0] as [string, Record<string, unknown>]
        expect(url).toBe('https://gateway.example/v1/models?limit=1000')
        expect(config).toMatchObject({ timeout: 3_000, maxRedirects: 0 })
        expect(config.validateStatus).toEqual(expect.any(Function))
        expect(config.headers).toMatchObject({
            Authorization: 'Bearer bearer-secret',
            'anthropic-version': '2023-06-01',
            'X-Trace-Id': 'trace-123'
        })
        expect(config.headers).not.toHaveProperty('Host')
        expect(config.headers).not.toHaveProperty('X-Bad')
        expect(config.headers).not.toHaveProperty('X-Unsafe')
        expect(config.headers).not.toHaveProperty('x-api-key')
        expect(result).toEqual({
            status: 'dynamic',
            models: [
                { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
                { id: 'anthropic/claude-opus', displayName: 'Gateway Opus' }
            ],
            source: 'gateway:gateway.example/v1'
        })
    })

    it('uses x-api-key when a bearer token is absent and supports a base URL without /v1', async () => {
        const httpGet = vi.fn().mockResolvedValue({
            status: 200,
            data: { data: [{ id: 'claude-custom' }] }
        })

        const result = await listAgentModels('claude', {
            cwd: '/repo',
            env: {
                ...validEnv,
                ANTHROPIC_BASE_URL: 'https://gateway.example/api/',
                ANTHROPIC_API_KEY: 'api-secret'
            },
            managedSettingsPaths: [],
            httpGet
        })

        expect(httpGet).toHaveBeenCalledWith(
            'https://gateway.example/api/v1/models?limit=1000',
            expect.objectContaining({
                headers: expect.objectContaining({ 'x-api-key': 'api-secret' })
            })
        )
        expect(result.models).toEqual([{ id: 'claude-custom', displayName: 'claude-custom' }])
    })

    it.each([
        ['redirect response', vi.fn().mockResolvedValue({ status: 302, data: {} })],
        ['HTTP error', vi.fn().mockResolvedValue({ status: 401, data: { error: 'api-secret' } })],
        ['malformed payload', vi.fn().mockResolvedValue({ status: 200, data: { data: 'not-an-array' } })],
        ['transport error', vi.fn().mockRejectedValue(new Error('api-secret https://gateway.example/private'))]
    ])('returns a sanitized failed result with fallback for %s', async (_name, httpGet) => {
        const result = await listAgentModels('claude', {
            cwd: '/repo',
            env: validEnv,
            managedSettingsPaths: [],
            httpGet
        })

        expect(result.status).toBe('failed')
        expect(result.models.map((model) => model.id)).toEqual(CLAUDE_MODEL_PRESETS)
        expect(result.error).toBe('Claude model discovery failed')
        expect(JSON.stringify(result)).not.toContain('test-secret')
    })
})

describe('Claude availableModels policy', () => {
    async function createPolicyFixture(): Promise<{
        root: string
        userConfig: string
        project: string
        managed: string
    }> {
        const root = await mkdtemp(join(tmpdir(), 'hapi-claude-model-policy-'))
        const userConfig = join(root, 'user-claude')
        const project = join(root, 'project')
        const managed = join(root, 'managed-settings.json')
        await mkdir(userConfig, { recursive: true })
        await mkdir(join(project, '.claude'), { recursive: true })
        return { root, userConfig, project, managed }
    }

    function gatewayResponse() {
        return {
            status: 200,
            data: {
                data: ['claude-a', 'claude-b', 'claude-c', 'claude-d']
                    .map((id) => ({ id }))
            }
        }
    }

    it('merges accessible user, project, and local allowlists', async () => {
        const fixture = await createPolicyFixture()
        try {
            await writeFile(join(fixture.userConfig, 'settings.json'), JSON.stringify({
                availableModels: ['claude-a', 'claude-b']
            }))
            await writeFile(join(fixture.project, '.claude', 'settings.json'), JSON.stringify({
                availableModels: ['claude-b', 'claude-c']
            }))
            await writeFile(join(fixture.project, '.claude', 'settings.local.json'), JSON.stringify({
                availableModels: ['claude-d']
            }))

            const result = await listAgentModels('claude', {
                cwd: fixture.project,
                env: { ...validEnv, CLAUDE_CONFIG_DIR: fixture.userConfig },
                managedSettingsPaths: [fixture.managed],
                httpGet: vi.fn().mockResolvedValue(gatewayResponse())
            })

            expect(result.status).toBe('dynamic')
            expect(result.models.map((model) => model.id)).toEqual([
                'claude-a',
                'claude-b',
                'claude-c',
                'claude-d'
            ])
        } finally {
            await rm(fixture.root, { recursive: true, force: true })
        }
    })

    it('uses a managed allowlist exclusively when present', async () => {
        const fixture = await createPolicyFixture()
        try {
            await writeFile(join(fixture.userConfig, 'settings.json'), JSON.stringify({
                availableModels: ['claude-a']
            }))
            await writeFile(fixture.managed, JSON.stringify({
                availableModels: ['claude-c']
            }))

            const result = await listAgentModels('claude', {
                cwd: fixture.project,
                env: { ...validEnv, CLAUDE_CONFIG_DIR: fixture.userConfig },
                managedSettingsPaths: [fixture.managed],
                httpGet: vi.fn().mockResolvedValue(gatewayResponse())
            })

            expect(result.models).toEqual([{ id: 'claude-c', displayName: 'claude-c' }])
        } finally {
            await rm(fixture.root, { recursive: true, force: true })
        }
    })

    it('keeps fallback presets inside the effective allowlist after an HTTP failure', async () => {
        const fixture = await createPolicyFixture()
        try {
            await writeFile(fixture.managed, JSON.stringify({
                availableModels: ['sonnet']
            }))

            const result = await listAgentModels('claude', {
                cwd: fixture.project,
                env: { ...validEnv, CLAUDE_CONFIG_DIR: fixture.userConfig },
                managedSettingsPaths: [fixture.managed],
                httpGet: vi.fn().mockResolvedValue({ status: 503, data: {} })
            })

            expect(result.status).toBe('failed')
            expect(result.models.map((model) => model.id)).toEqual(['sonnet', 'sonnet[1m]'])
        } finally {
            await rm(fixture.root, { recursive: true, force: true })
        }
    })

    it('does not broaden a 1m-only fallback policy to the whole model family', async () => {
        const fixture = await createPolicyFixture()
        try {
            await writeFile(fixture.managed, JSON.stringify({
                availableModels: ['sonnet[1m]']
            }))

            const result = await listAgentModels('claude', {
                cwd: fixture.project,
                env: { ...validEnv, CLAUDE_CONFIG_DIR: fixture.userConfig },
                managedSettingsPaths: [fixture.managed],
                httpGet: vi.fn().mockResolvedValue({ status: 503, data: {} })
            })

            expect(result.models.map((model) => model.id)).toEqual(['sonnet[1m]'])
        } finally {
            await rm(fixture.root, { recursive: true, force: true })
        }
    })

    it('treats a family alias as a wildcard unless a specific family version is listed', async () => {
        const fixture = await createPolicyFixture()
        try {
            await writeFile(fixture.managed, JSON.stringify({
                availableModels: ['sonnet', 'claude-sonnet-4-5']
            }))
            const httpGet = vi.fn().mockResolvedValue({
                status: 200,
                data: {
                    data: [
                        { id: 'claude-sonnet-4-5-20250929' },
                        { id: 'claude-sonnet-4-6' },
                        { id: 'claude-opus-4-6' }
                    ]
                }
            })

            const result = await listAgentModels('claude', {
                cwd: fixture.project,
                env: { ...validEnv, CLAUDE_CONFIG_DIR: fixture.userConfig },
                managedSettingsPaths: [fixture.managed],
                httpGet
            })

            expect(result.models.map((model) => model.id)).toEqual([
                'claude-sonnet-4-5-20250929'
            ])
        } finally {
            await rm(fixture.root, { recursive: true, force: true })
        }
    })

    it('blocks discovery when an existing managed settings file is invalid', async () => {
        const fixture = await createPolicyFixture()
        try {
            await writeFile(fixture.managed, '{ invalid json')
            const httpGet = vi.fn()

            const result = await listAgentModels('claude', {
                cwd: fixture.project,
                env: { ...validEnv, CLAUDE_CONFIG_DIR: fixture.userConfig },
                managedSettingsPaths: [fixture.managed],
                httpGet
            })

            expect(result.status).toBe('unsupported')
            expect(result.models).toEqual([])
            expect(httpGet).not.toHaveBeenCalled()
        } finally {
            await rm(fixture.root, { recursive: true, force: true })
        }
    })
})
