import type { MermaidConfig } from 'mermaid'

export type MermaidTheme = 'light' | 'dark'

export type MermaidApi = {
    initialize(config: MermaidConfig): void
    parse?(code: string): unknown | Promise<unknown>
    render(id: string, code: string): Promise<{ svg: string }>
}

export type MermaidRenderRequest = {
    id: string
    code: string
    theme: MermaidTheme
    signal?: AbortSignal
}

const SECURE_KEYS = [
    'secure',
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
]
const MAX_TEXT_SIZE = 50_000

function abortError(): DOMException {
    return new DOMException('Mermaid render aborted', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError()
}

function configFor(theme: MermaidTheme): MermaidConfig {
    return {
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        maxTextSize: MAX_TEXT_SIZE,
        maxEdges: 500,
        secure: SECURE_KEYS,
        theme: theme === 'dark' ? 'dark' : 'default',
        darkMode: theme === 'dark',
    }
}

export function createMermaidRenderer(loadMermaid: () => Promise<MermaidApi>) {
    let queue: Promise<void> = Promise.resolve()

    const render = (request: MermaidRenderRequest): Promise<string> => {
        const task = queue.then(async () => {
            throwIfAborted(request.signal)
            if (request.code.length > MAX_TEXT_SIZE) {
                throw new Error('Mermaid source exceeds the configured text limit')
            }
            const mermaid = await loadMermaid()
            throwIfAborted(request.signal)
            mermaid.initialize(configFor(request.theme))
            await mermaid.parse?.(request.code)
            throwIfAborted(request.signal)
            const result = await mermaid.render(request.id, request.code)
            throwIfAborted(request.signal)
            return result.svg
        })
        queue = task.then(() => undefined, () => undefined)
        return task
    }

    return { render }
}

const defaultRenderer = createMermaidRenderer(async () => (await import('mermaid')).default)

export const renderMermaid = defaultRenderer.render
