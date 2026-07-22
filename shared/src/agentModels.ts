import { z } from 'zod'
import type { AgentFlavor } from './modes'

export const AgentModelCatalogStatusSchema = z.enum([
    'dynamic',
    'fallback',
    'unsupported',
    'failed'
])

export const AgentModelDescriptorSchema = z.object({
    id: z.string().min(1),
    displayName: z.string().min(1)
})

export const AgentModelCatalogResultSchema = z.object({
    status: AgentModelCatalogStatusSchema,
    models: z.array(AgentModelDescriptorSchema),
    source: z.string().min(1),
    error: z.string().min(1).optional()
})

export const CachedAgentModelCatalogSchema = AgentModelCatalogResultSchema.omit({ error: true }).extend({
    agent: z.string().min(1),
    cachedAt: z.number()
})

export type AgentModelCatalogStatus = z.infer<typeof AgentModelCatalogStatusSchema>
export type AgentModelDescriptor = z.infer<typeof AgentModelDescriptorSchema>
export type AgentModelCatalogResult = z.infer<typeof AgentModelCatalogResultSchema>
export type CachedAgentModelCatalog = z.infer<typeof CachedAgentModelCatalogSchema>

export type AgentModelCatalogRequest = {
    agent: AgentFlavor
    cwd?: string
}
