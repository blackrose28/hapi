import { describe, expect, it, vi } from 'vitest'
import { createMermaidRenderer, type MermaidApi } from './mermaid-renderer'

function fakeApi(events: string[]): MermaidApi {
    return {
        initialize: vi.fn((config) => events.push(`init:${config.theme}`)),
        render: vi.fn(async (id, code) => {
            events.push(`render:${id}:${code}`)
            return { svg: `<svg data-id="${id}"></svg>` }
        }),
    }
}

describe('createMermaidRenderer', () => {
    it('locks security, limits, error rendering, and theme keys', async () => {
        const events: string[] = []
        const api = fakeApi(events)
        const renderer = createMermaidRenderer(async () => api)

        await renderer.render({ id: 'diagram-1', code: 'flowchart LR\nA-->B', theme: 'dark' })

        expect(api.initialize).toHaveBeenCalledWith(expect.objectContaining({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            maxTextSize: 50_000,
            maxEdges: 500,
            theme: 'dark',
            secure: expect.arrayContaining([
                'securityLevel',
                'startOnLoad',
                'maxTextSize',
                'maxEdges',
                'suppressErrorRendering',
                'theme',
                'themeVariables',
                'themeCSS',
                'fontFamily',
                'htmlLabels',
            ]),
        }))
    })

    it('serializes initialize and render across diagrams', async () => {
        const events: string[] = []
        let releaseFirst: (() => void) | undefined
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
        const api: MermaidApi = {
            initialize: (config) => { events.push(`init:${config.theme}`) },
            render: async (id) => {
                events.push(`start:${id}`)
                if (id === 'first') await firstGate
                events.push(`end:${id}`)
                return { svg: `<svg id="${id}"></svg>` }
            },
        }
        const renderer = createMermaidRenderer(async () => api)
        const first = renderer.render({ id: 'first', code: 'flowchart LR', theme: 'dark' })
        const second = renderer.render({ id: 'second', code: 'sequenceDiagram', theme: 'light' })

        await Promise.resolve()
        expect(events).not.toContain('start:second')
        releaseFirst?.()
        await Promise.all([first, second])
        expect(events).toEqual([
            'init:dark',
            'start:first',
            'end:first',
            'init:default',
            'start:second',
            'end:second',
        ])
    })

    it('skips an aborted request before it reaches Mermaid', async () => {
        const api = fakeApi([])
        const renderer = createMermaidRenderer(async () => api)
        const controller = new AbortController()
        controller.abort()

        await expect(renderer.render({
            id: 'stale',
            code: 'flowchart LR',
            theme: 'light',
            signal: controller.signal,
        })).rejects.toMatchObject({ name: 'AbortError' })
        expect(api.render).not.toHaveBeenCalled()
    })

    it('rejects oversized source before loading Mermaid', async () => {
        const loadMermaid = vi.fn(async () => fakeApi([]))
        const renderer = createMermaidRenderer(loadMermaid)

        await expect(renderer.render({
            id: 'too-long', code: 'x'.repeat(50_001), theme: 'light',
        })).rejects.toThrow('text limit')
        expect(loadMermaid).not.toHaveBeenCalled()
    })
})
