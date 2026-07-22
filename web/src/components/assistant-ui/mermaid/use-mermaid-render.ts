import { useEffect, useRef, useState } from 'react'
import { renderMermaid, type MermaidTheme } from './mermaid-renderer'

type State = { svg: string | null; loading: boolean; error: Error | null }

export function useMermaidRender(input: {
    id: string
    code: string
    theme: MermaidTheme
    streaming: boolean
    retryKey: number
}): State {
    const [state, setState] = useState<State>({ svg: null, loading: true, error: null })
    const generation = useRef(0)

    useEffect(() => {
        const current = ++generation.current
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined

        const run = async () => {
            setState((previous) => ({ ...previous, loading: previous.svg === null, error: null }))
            try {
                const svg = await renderMermaid({
                    id: `${input.id}-${current}`,
                    code: input.code,
                    theme: input.theme,
                    signal: controller.signal,
                })
                if (generation.current === current) setState({ svg, loading: false, error: null })
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') return
                if (generation.current === current) {
                    setState((previous) => ({
                        ...previous,
                        loading: false,
                        error: error instanceof Error ? error : new Error('Mermaid render failed'),
                    }))
                }
            }
        }

        if (input.streaming) timer = setTimeout(() => { void run() }, 250)
        else void run()

        return () => {
            controller.abort()
            if (timer) clearTimeout(timer)
        }
    }, [input.id, input.code, input.theme, input.streaming, input.retryKey])

    return state
}
