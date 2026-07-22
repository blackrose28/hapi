import { describe, expect, test } from 'bun:test'
import {
    AgentModelCatalogResultSchema,
    AgentModelDescriptorSchema
} from './agentModels'
import { MetadataSchema } from './schemas'

describe('AgentModelDescriptorSchema', () => {
    test('accepts a sanitized model descriptor', () => {
        expect(AgentModelDescriptorSchema.parse({
            id: 'claude-sonnet-4-5',
            displayName: 'Claude Sonnet 4.5'
        })).toEqual({
            id: 'claude-sonnet-4-5',
            displayName: 'Claude Sonnet 4.5'
        })
    })

    test('rejects empty identifiers and display names', () => {
        expect(() => AgentModelDescriptorSchema.parse({ id: '', displayName: 'Claude' })).toThrow()
        expect(() => AgentModelDescriptorSchema.parse({ id: 'claude', displayName: '' })).toThrow()
    })
})

describe('AgentModelCatalogResultSchema', () => {
    test('accepts the supported catalog statuses', () => {
        for (const status of ['dynamic', 'fallback', 'unsupported', 'failed'] as const) {
            expect(AgentModelCatalogResultSchema.parse({
                status,
                models: [],
                source: 'claude-gateway'
            }).status).toBe(status)
        }
    })

    test('rejects unknown statuses', () => {
        expect(() => AgentModelCatalogResultSchema.parse({
            status: 'stale',
            models: [],
            source: 'claude-gateway'
        })).toThrow()
    })
})

describe('MetadataSchema cachedAgentModels', () => {
    test('parses a cached generic model catalog', () => {
        const metadata = MetadataSchema.parse({
            path: '/repo',
            host: 'machine',
            cachedAgentModels: {
                agent: 'claude',
                status: 'dynamic',
                models: [{ id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' }],
                source: 'claude-gateway',
                cachedAt: 123
            }
        })

        expect(metadata.cachedAgentModels?.agent).toBe('claude')
        expect(metadata.cachedAgentModels?.models).toHaveLength(1)
    })
})
