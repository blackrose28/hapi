# Mermaid Chat Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render lowercase `mermaid` code fences in assistant final messages as secure, theme-aware SVG previews with source fallback, zoom, pan, fit, and browser-native fullscreen.

**Architecture:** Route only `language="mermaid"` through `MarkdownTextPrimitive.componentsByLanguage`. A lazy, serialized renderer owns Mermaid's global configuration; a React hook handles streaming debounce/stale results; a Panzoom-backed canvas owns transforms; `MermaidBlock` owns toolbar, source/error state, and Fullscreen API lifecycle. Hub, CLI, shared protocol, database, reasoning/tool output, and Editor Markdown file preview stay unchanged.

**Tech Stack:** React 19, TypeScript strict, `@assistant-ui/react-markdown`, Mermaid 11, `@panzoom/panzoom` 4, Vitest/jsdom, Tailwind/CSS container queries, Bun workspaces, Vite PWA.

## Global Constraints

- Run Bun commands from repository root; indentation is 4 spaces; no untyped code.
- Preview only lowercase fenced code blocks labeled `mermaid`; do not infer unlabeled blocks or add `mmd` aliases.
- Default view is preview. Source view must preserve and copy the exact original code.
- Mermaid configuration: `startOnLoad: false`, `securityLevel: 'strict'`, `suppressErrorRendering: true`, `maxTextSize: 50_000`, `maxEdges: 500`.
- Secure keys must also lock HAPI theme, `themeCSS`, `fontFamily`, and `htmlLabels` against diagram directives.
- Inline interaction: drag to pan; wheel zoom only with `Ctrl`/`Cmd`; ordinary wheel continues scrolling chat.
- Fullscreen interaction: wheel/pinch zoom, drag pan, native `Esc`; no modal fallback.
- Zoom range 10%–500%; buttons multiply/divide by 1.2; fit padding 24 px; arrow-key pan step 40 px.
- Inline canvas: `clamp(260px, 45vh, 520px)`; container under 360 px caps at 320 px.
- Responsive toolbar: labels at 520 px and wider; icon-only below 520 px; two rows below 360 px; touch targets at least 44×44 px.
- Dynamic import Mermaid; do not use a CDN; do not increase the current PWA precache limit of 4 MiB merely to pass build.
- Do not log diagram source or stack traces to user-visible UI.
- Keep `manifest.orientation: 'portrait'` unchanged.

## File Structure

| File | Responsibility |
|---|---|
| `web/src/components/assistant-ui/mermaid/mermaid-renderer.ts` | Lazy Mermaid loader, locked configuration, serialized render queue, abort/stale guard |
| `web/src/components/assistant-ui/mermaid/use-mermaid-render.ts` | 250 ms streaming debounce and last-good SVG state |
| `web/src/components/assistant-ui/mermaid/MermaidCanvas.tsx` | SVG insertion, Panzoom lifecycle, wheel/keyboard/pinch/pan/fit |
| `web/src/components/assistant-ui/mermaid/MermaidToolbar.tsx` | Accessible localized preview/source/zoom/fit/fullscreen controls |
| `web/src/components/assistant-ui/mermaid/MermaidErrorBoundary.tsx` | Block-local React failure fallback |
| `web/src/components/assistant-ui/mermaid/MermaidBlock.tsx` | State orchestration and Fullscreen API lifecycle |
| `web/src/components/assistant-ui/mermaid/index.ts` | Stable language override export |
| `web/src/components/assistant-ui/mermaid/*.test.tsx` | Unit/integration tests for each responsibility |
| `web/src/components/assistant-ui/markdown-text.tsx` | Register the stable language override only on assistant final text |
| `web/src/components/icons.tsx` | Reusable code/zoom/fit/fullscreen SVG icons |
| `web/src/index.css` | Scoped Mermaid container/fullscreen/responsive styles |
| `web/src/lib/locales/{en,vi-VN,zh-CN}.ts` | Toolbar, status, and error strings |
| `web/package.json`, `bun.lock` | Pin Mermaid and Panzoom dependencies |

---

### Task 1: Secure Serialized Mermaid Renderer

**Files:**
- Modify: `web/package.json`
- Modify: `bun.lock`
- Create: `web/src/components/assistant-ui/mermaid/mermaid-renderer.ts`
- Test: `web/src/components/assistant-ui/mermaid/mermaid-renderer.test.ts`

**Interfaces:**
- Produces: `MermaidTheme = 'light' | 'dark'`.
- Produces: `MermaidRenderRequest = { id: string; code: string; theme: MermaidTheme; signal?: AbortSignal }`.
- Produces: `createMermaidRenderer(loadMermaid).render(request): Promise<string>` and singleton `renderMermaid(request): Promise<string>`.
- Later tasks must treat an `AbortError` as stale/cancelled rather than a user-visible syntax error.

- [ ] **Step 1: Add dependencies from the repository root**

```bash
bun add --cwd web mermaid@^11.16.0 @panzoom/panzoom@^4.6.2
```

Expected: `web/package.json` contains both dependencies and `bun.lock` changes once.

- [ ] **Step 2: Write failing renderer tests**

Create `mermaid-renderer.test.ts` with a typed fake Mermaid API and these tests:

```ts
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
                'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges',
                'suppressErrorRendering', 'theme', 'themeVariables', 'themeCSS',
                'fontFamily', 'htmlLabels',
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
            'init:dark', 'start:first', 'end:first',
            'init:default', 'start:second', 'end:second',
        ])
    })

    it('skips an aborted request before it reaches Mermaid', async () => {
        const api = fakeApi([])
        const renderer = createMermaidRenderer(async () => api)
        const controller = new AbortController()
        controller.abort()

        await expect(renderer.render({
            id: 'stale', code: 'flowchart LR', theme: 'light', signal: controller.signal,
        })).rejects.toMatchObject({ name: 'AbortError' })
        expect(api.render).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 3: Run the focused test and verify RED**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/mermaid-renderer.test.ts
```

Expected: FAIL because `./mermaid-renderer` does not exist.

- [ ] **Step 4: Implement the minimal renderer**

Create `mermaid-renderer.ts`:

```ts
import type { MermaidConfig } from 'mermaid'

export type MermaidTheme = 'light' | 'dark'
export type MermaidApi = {
    initialize(config: MermaidConfig): void
    render(id: string, code: string): Promise<{ svg: string }>
}
export type MermaidRenderRequest = {
    id: string
    code: string
    theme: MermaidTheme
    signal?: AbortSignal
}

const SECURE_KEYS = [
    'secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges',
    'suppressErrorRendering', 'theme', 'themeVariables', 'themeCSS',
    'fontFamily', 'htmlLabels',
]

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
        maxTextSize: 50_000,
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
            const mermaid = await loadMermaid()
            throwIfAborted(request.signal)
            mermaid.initialize(configFor(request.theme))
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
```

- [ ] **Step 5: Run tests and typecheck the web package**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/mermaid-renderer.test.ts
bun run --cwd web typecheck
```

Expected: renderer tests PASS; typecheck PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add web/package.json bun.lock web/src/components/assistant-ui/mermaid/mermaid-renderer.ts web/src/components/assistant-ui/mermaid/mermaid-renderer.test.ts
git commit -m "feat(web): add secure Mermaid renderer"
```

---

### Task 2: Streaming Hook and Block-Local Failure Isolation

**Files:**
- Create: `web/src/components/assistant-ui/mermaid/use-mermaid-render.ts`
- Create: `web/src/components/assistant-ui/mermaid/MermaidErrorBoundary.tsx`
- Test: `web/src/components/assistant-ui/mermaid/use-mermaid-render.test.tsx`
- Test: `web/src/components/assistant-ui/mermaid/MermaidErrorBoundary.test.tsx`

**Interfaces:**
- Consumes: `renderMermaid({ id, code, theme, signal })` from Task 1.
- Produces: `useMermaidRender({ id, code, theme, streaming, retryKey })` returning `{ svg, loading, error }`.
- Produces: `MermaidErrorBoundary({ resetKey, fallback, children })`.

- [ ] **Step 1: Write failing hook tests with fake timers and a mocked renderer**

```ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMermaidRender } from './use-mermaid-render'
import { renderMermaid } from './mermaid-renderer'

vi.mock('./mermaid-renderer', () => ({ renderMermaid: vi.fn() }))
const mockedRender = vi.mocked(renderMermaid)

describe('useMermaidRender', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        mockedRender.mockReset()
    })

    it('debounces streaming by 250 ms and renders final content immediately', async () => {
        mockedRender.mockResolvedValue('<svg id="ok"></svg>')
        const { rerender, result } = renderHook(
            ({ code, streaming }) => useMermaidRender({
                id: 'm-1', code, theme: 'dark', streaming, retryKey: 0,
            }),
            { initialProps: { code: 'flowchart L', streaming: true } },
        )
        expect(mockedRender).not.toHaveBeenCalled()
        await act(async () => { vi.advanceTimersByTime(249) })
        expect(mockedRender).not.toHaveBeenCalled()
        rerender({ code: 'flowchart LR\nA-->B', streaming: false })
        await act(async () => { await Promise.resolve() })
        expect(mockedRender).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'flowchart LR\nA-->B' }))
        expect(result.current.svg).toBe('<svg id="ok"></svg>')
    })

    it('keeps the last good SVG while a streaming revision is pending', async () => {
        mockedRender.mockResolvedValueOnce('<svg id="first"></svg>')
        const { rerender, result } = renderHook(
            ({ code, streaming }) => useMermaidRender({
                id: 'm-1', code, theme: 'light', streaming, retryKey: 0,
            }),
            { initialProps: { code: 'flowchart LR\nA-->B', streaming: false } },
        )
        await act(async () => { await Promise.resolve() })
        rerender({ code: 'flowchart LR\nA-->B\nB-->C', streaming: true })
        expect(result.current.svg).toBe('<svg id="first"></svg>')
    })

    it('ignores AbortError but exposes a settled syntax error', async () => {
        mockedRender.mockRejectedValueOnce(new DOMException('stale', 'AbortError'))
        const { rerender, result } = renderHook(
            ({ retryKey }) => useMermaidRender({
                id: 'm-1', code: 'invalid', theme: 'light', streaming: false, retryKey,
            }),
            { initialProps: { retryKey: 0 } },
        )
        await act(async () => { await Promise.resolve() })
        expect(result.current.error).toBeNull()
        mockedRender.mockRejectedValueOnce(new Error('Parse error'))
        rerender({ retryKey: 1 })
        await act(async () => { await Promise.resolve() })
        expect(result.current.error).toBeInstanceOf(Error)
    })
})
```

- [ ] **Step 2: Run hook tests and verify RED**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/use-mermaid-render.test.tsx
```

Expected: FAIL because the hook is missing.

- [ ] **Step 3: Implement the hook with cleanup and generation protection**

```ts
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
                    id: input.id,
                    code: input.code,
                    theme: input.theme,
                    signal: controller.signal,
                })
                if (generation.current === current) setState({ svg, loading: false, error: null })
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') return
                if (generation.current === current) {
                    setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error : new Error('Mermaid render failed') }))
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
```

- [ ] **Step 4: Write and run failing ErrorBoundary tests**

Test that a throwing child renders only the supplied source fallback and resets after `resetKey` changes:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { MermaidErrorBoundary } from './MermaidErrorBoundary'

function Thrower(): never { throw new Error('boom') }

it('isolates a block and resets on source change', () => {
    function Harness() {
        const [key, setKey] = useState('old')
        return <>
            <button onClick={() => setKey('new')}>reset</button>
            <MermaidErrorBoundary resetKey={key} fallback={<pre>source fallback</pre>}>
                {key === 'old' ? <Thrower /> : <div>preview restored</div>}
            </MermaidErrorBoundary>
        </>
    }
    render(<Harness />)
    expect(screen.getByText('source fallback')).toBeInTheDocument()
    fireEvent.click(screen.getByText('reset'))
    expect(screen.getByText('preview restored')).toBeInTheDocument()
})
```

Expected first run: FAIL because `MermaidErrorBoundary` is missing.

- [ ] **Step 5: Implement the typed class boundary and rerun Task 2 tests**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { resetKey: string; fallback: ReactNode; children: ReactNode }
type State = { failed: boolean }

export class MermaidErrorBoundary extends Component<Props, State> {
    state: State = { failed: false }

    static getDerivedStateFromError(): State {
        return { failed: true }
    }

    componentDidCatch(_error: Error, _info: ErrorInfo): void {
        // Intentionally do not log diagram source or render children.
    }

    componentDidUpdate(previous: Props): void {
        if (this.state.failed && previous.resetKey !== this.props.resetKey) {
            this.setState({ failed: false })
        }
    }

    render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}
```

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/use-mermaid-render.test.tsx src/components/assistant-ui/mermaid/MermaidErrorBoundary.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add web/src/components/assistant-ui/mermaid/use-mermaid-render.ts web/src/components/assistant-ui/mermaid/use-mermaid-render.test.tsx web/src/components/assistant-ui/mermaid/MermaidErrorBoundary.tsx web/src/components/assistant-ui/mermaid/MermaidErrorBoundary.test.tsx
git commit -m "feat(web): handle streamed Mermaid renders"
```

---

### Task 3: Pan, Zoom, Fit, Wheel, Pinch, and Keyboard Canvas

**Files:**
- Create: `web/src/components/assistant-ui/mermaid/MermaidCanvas.tsx`
- Test: `web/src/components/assistant-ui/mermaid/MermaidCanvas.test.tsx`

**Interfaces:**
- Produces: `MermaidCanvasHandle = { zoomIn(): void; zoomOut(): void; fit(): void; panBy(dx: number, dy: number): void }`.
- Produces props: `{ svg: string; fullscreen: boolean; ariaLabel: string; onScaleChange(scale: number): void }`.
- Task 4 calls the imperative handle from toolbar buttons.

- [ ] **Step 1: Write failing canvas tests with a typed Panzoom mock**

Mock `Panzoom` to expose `zoomIn`, `zoomOut`, `zoom`, `zoomWithWheel`, `pan`, `getPan`, `getScale`, and `destroy`. Include these tests:

```tsx
it('lets ordinary inline wheel bubble but zooms Ctrl/Cmd wheel', () => {
    const { container } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
    const canvas = container.querySelector('[data-mermaid-canvas]')!
    const plain = new WheelEvent('wheel', { bubbles: true, cancelable: true })
    canvas.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
    expect(panzoom.zoomWithWheel).not.toHaveBeenCalled()
    const modified = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true })
    canvas.dispatchEvent(modified)
    expect(panzoom.zoomWithWheel).toHaveBeenCalledWith(modified)
})

it('zooms fullscreen wheel without a modifier', () => {
    const { container } = render(<MermaidCanvas svg={SVG} fullscreen ariaLabel="Diagram" onScaleChange={() => {}} />)
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true })
    container.querySelector('[data-mermaid-canvas]')!.dispatchEvent(wheel)
    expect(panzoom.zoomWithWheel).toHaveBeenCalledWith(wheel)
})

it('supports keyboard pan, zoom, and fit', () => {
    const { getByRole } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
    const canvas = getByRole('application')
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(panzoom.pan).toHaveBeenCalledWith(40, 0, expect.objectContaining({ relative: true }))
    fireEvent.keyDown(canvas, { key: '+' })
    expect(panzoom.zoomIn).toHaveBeenCalled()
    fireEvent.keyDown(canvas, { key: '0' })
    expect(panzoom.zoom).toHaveBeenCalled()
})

it('destroys Panzoom and removes listeners on unmount', () => {
    const { unmount } = render(<MermaidCanvas svg={SVG} fullscreen={false} ariaLabel="Diagram" onScaleChange={() => {}} />)
    unmount()
    expect(panzoom.destroy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run canvas tests and verify RED**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/MermaidCanvas.test.tsx
```

Expected: FAIL because `MermaidCanvas` is missing.

- [ ] **Step 3: Implement the forwardRef canvas**

Use an HTML transform wrapper containing Mermaid SVG, not the SVG node itself:

```tsx
const panzoom = Panzoom(content, {
    canvas: true,
    minScale: 0.1,
    maxScale: 5,
    step: 0.2,
    pinchAndPan: true,
    animate: false,
    excludeClass: 'mermaid-panzoom-exclude',
})
```

Bind a non-passive wheel listener on the canvas:

```ts
const onWheel = (event: WheelEvent) => {
    if (!fullscreen && !event.ctrlKey && !event.metaKey) return
    panzoom.zoomWithWheel(event)
}
canvas.addEventListener('wheel', onWheel, { passive: false })
```

Implement fit from the generated SVG `viewBox`, the canvas client size, and 24 px padding:

```ts
const width = Math.max(svg.viewBox.baseVal.width, 1)
const height = Math.max(svg.viewBox.baseVal.height, 1)
const scale = Math.min(5, Math.max(0.1,
    Math.min((canvas.clientWidth - 48) / width, (canvas.clientHeight - 48) / height),
))
panzoom.zoom(scale, { animate: false, force: true })
requestAnimationFrame(() => panzoom.pan(0, 0, { animate: false, force: true }))
```

Wait for `document.fonts.ready` when available before initial fit. Listen for `panzoomchange` to call `onScaleChange(detail.scale)`. Add `role="application"`, `tabIndex={0}`, localized `aria-label` supplied as a prop, and the specified keyboard map. Respect reduced motion by keeping Panzoom animation disabled.

- [ ] **Step 4: Run canvas tests and typecheck**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/MermaidCanvas.test.tsx
bun run --cwd web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add web/src/components/assistant-ui/mermaid/MermaidCanvas.tsx web/src/components/assistant-ui/mermaid/MermaidCanvas.test.tsx
git commit -m "feat(web): add Mermaid pan and zoom canvas"
```

---

### Task 4: Toolbar, Source Fallback, Fullscreen, Responsive UI, and Locales

**Files:**
- Create: `web/src/components/assistant-ui/mermaid/MermaidToolbar.tsx`
- Create: `web/src/components/assistant-ui/mermaid/MermaidBlock.tsx`
- Test: `web/src/components/assistant-ui/mermaid/MermaidBlock.test.tsx`
- Modify: `web/src/components/icons.tsx`
- Modify: `web/src/index.css`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/vi-VN.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Interfaces:**
- Consumes: hook and boundary from Task 2; `MermaidCanvasHandle` from Task 3.
- Produces: `MermaidBlock(props: SyntaxHighlighterProps)`.
- Produces: block root attribute `data-mermaid-block`, canvas attribute `data-mermaid-canvas`, scoped classes prefixed `mermaid-preview__`.

- [ ] **Step 1: Add failing block tests**

Mock `useMermaidRender` and `MermaidCanvas`. Provide `I18nProvider`, `TextMessagePartProvider`, and assistant message state where required. Include these tests:

```tsx
it('defaults to preview and toggles exact source text', () => {
    mockedHook.mockReturnValue({ svg: '<svg></svg>', loading: false, error: null })
    renderBlock('flowchart LR\nA-->B')
    expect(screen.getByTestId('mermaid-canvas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /view source/i }))
    expect(screen.getByText('flowchart LR\nA-->B')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /view diagram/i }))
    expect(screen.getByTestId('mermaid-canvas')).toBeInTheDocument()
})

it('falls back to source on render error and retries only on user action', () => {
    mockedHook.mockReturnValue({ svg: null, loading: false, error: new Error('Parse error') })
    renderBlock('invalid')
    expect(screen.getByText('invalid')).toBeInTheDocument()
    expect(screen.queryByText('Parse error')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry preview/i }))
    expect(mockedHook).toHaveBeenLastCalledWith(expect.objectContaining({ retryKey: 1 }))
})

it('requests fullscreen directly and syncs only its own fullscreen element', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const { block } = renderBlock('flowchart LR', { requestFullscreen })
    fireEvent.click(screen.getByRole('button', { name: /enter fullscreen/i }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: block })
    fireEvent(document, new Event('fullscreenchange'))
    expect(screen.getByRole('button', { name: /exit fullscreen/i })).toBeInTheDocument()
})

it('keeps preview and shows a local status when fullscreen rejects', async () => {
    renderBlock('flowchart LR', { requestFullscreen: vi.fn().mockRejectedValue(new TypeError('denied')) })
    fireEvent.click(screen.getByRole('button', { name: /enter fullscreen/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/fullscreen unavailable/i)
    expect(screen.getByTestId('mermaid-canvas')).toBeInTheDocument()
})

it('disables fullscreen when the API is absent', () => {
    renderBlock('flowchart LR', { requestFullscreen: undefined })
    expect(screen.getByRole('button', { name: /enter fullscreen/i })).toBeDisabled()
})
```

- [ ] **Step 2: Run block tests and verify RED**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/MermaidBlock.test.tsx
```

Expected: FAIL because block/toolbar are missing.

- [ ] **Step 3: Add reusable icons and locale keys**

Add these typed icons to `icons.tsx`:

```tsx
export function PlusIcon(props: IconProps) {
    return createIcon(<path d="M12 5v14M5 12h14" />, props, 2)
}
export function MinusIcon(props: IconProps) {
    return createIcon(<path d="M5 12h14" />, props, 2)
}
export function CodeIcon(props: IconProps) {
    return createIcon(<path d="m8 9-3 3 3 3m8-6 3 3-3 3m-3-9-2 12" />, props, 2)
}
export function FitIcon(props: IconProps) {
    return createIcon(<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5M8 8h8v8H8z" />, props)
}
export function FullscreenIcon(props: IconProps) {
    return createIcon(<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" />, props, 2)
}
export function ExitFullscreenIcon(props: IconProps) {
    return createIcon(<path d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5" />, props, 2)
}
```

Add the same keys to all three locale dictionaries:

```ts
'mermaid.preview': 'Preview',
'mermaid.viewSource': 'View source',
'mermaid.viewDiagram': 'View diagram',
'mermaid.copySource': 'Copy Mermaid source',
'mermaid.zoomIn': 'Zoom in',
'mermaid.zoomOut': 'Zoom out',
'mermaid.fit': 'Fit diagram',
'mermaid.enterFullscreen': 'Enter fullscreen',
'mermaid.exitFullscreen': 'Exit fullscreen',
'mermaid.canvas': 'Interactive Mermaid diagram. Drag to pan.',
'mermaid.loading': 'Rendering diagram…',
'mermaid.renderError': 'Could not preview this Mermaid diagram.',
'mermaid.retry': 'Retry preview',
'mermaid.fullscreenUnavailable': 'Fullscreen is unavailable in this browser.',
```

Vietnamese and Chinese files must translate every key rather than relying on English fallback.

- [ ] **Step 4: Implement toolbar and block**

`MermaidBlock` must:

```tsx
const streaming = useAssistantState(({ message }) => message.status?.type === 'running')
const { colorScheme } = useTheme()
const [mode, setMode] = useState<'preview' | 'source'>('preview')
const [retryKey, setRetryKey] = useState(0)
const [fullscreen, setFullscreen] = useState(false)
const [scale, setScale] = useState(1)
const canvasRef = useRef<MermaidCanvasHandle>(null)
const blockRef = useRef<HTMLDivElement>(null)
const render = useMermaidRender({ id, code, theme: colorScheme, streaming, retryKey })
const showSource = mode === 'source' || render.error !== null
```

Do not mutate `mode` when render fails: derive `showSource` as above so a later code/theme change can clear the error and restore preview unless the user explicitly chose source. `requestFullscreen()` must be invoked inside the click handler before any `await`. A document-level `fullscreenchange` listener sets `fullscreen` from `document.fullscreenElement === blockRef.current`; cleanup removes it. Exit uses `document.exitFullscreen()`.

Source view uses the existing `CodeBlock` with `language="text"` and `showCopyButton={false}` because the integrated toolbar owns copy. Copy always receives the exact `props.code` string.

- [ ] **Step 5: Add scoped responsive and fullscreen CSS**

Append only selectors rooted at `.mermaid-preview`:

```css
.mermaid-preview { container-type: inline-size; }
.mermaid-preview__canvas { height: clamp(260px, 45vh, 520px); touch-action: none; }
.mermaid-preview:fullscreen {
    width: 100vw;
    height: 100vh;
    background: var(--app-bg);
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
}
.mermaid-preview:fullscreen .mermaid-preview__canvas { height: calc(100vh - 48px); }
@container (max-width: 519px) {
    .mermaid-preview__label, .mermaid-preview__badge, .mermaid-preview__scale { display: none; }
    .mermaid-preview__action { min-width: 44px; min-height: 44px; }
}
@container (max-width: 359px) {
    .mermaid-preview__header { flex-wrap: wrap; }
    .mermaid-preview__toolbar { width: 100%; justify-content: flex-end; }
    .mermaid-preview__canvas { height: min(45vh, 320px); }
}
```

Use `cursor: grab/grabbing`, clear focus-visible rings, and no transform transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 6: Run focused tests, locale consistency check, and typecheck**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/MermaidBlock.test.tsx
bun run --cwd web typecheck
for key in $(rg -o "'mermaid\.[^']+'" web/src/lib/locales/en.ts | tr -d "'"); do
    rg -q "'$key':" web/src/lib/locales/vi-VN.ts
    rg -q "'$key':" web/src/lib/locales/zh-CN.ts
done
```

Expected: tests and typecheck PASS; the locale loop exits 0, proving every English `mermaid.*` key exists in Vietnamese and Chinese.

- [ ] **Step 7: Commit Task 4**

```bash
git add web/src/components/assistant-ui/mermaid/MermaidToolbar.tsx web/src/components/assistant-ui/mermaid/MermaidBlock.tsx web/src/components/assistant-ui/mermaid/MermaidBlock.test.tsx web/src/components/icons.tsx web/src/index.css web/src/lib/locales/en.ts web/src/lib/locales/vi-VN.ts web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add Mermaid preview controls"
```

---

### Task 5: Markdown Language Routing and Security/Surface Integration

**Files:**
- Create: `web/src/components/assistant-ui/mermaid/index.ts`
- Create: `web/src/components/assistant-ui/mermaid/mermaid-integration.test.tsx`
- Create: `web/src/components/assistant-ui/mermaid/mermaid-security.test.ts`
- Modify: `web/src/components/assistant-ui/markdown-text.tsx`

**Interfaces:**
- Produces stable `MERMAID_LANGUAGE_COMPONENTS` matching `MarkdownTextPrimitiveProps['componentsByLanguage']`.
- No other Markdown renderer receives this mapping in the first release.

- [ ] **Step 1: Write failing routing tests**

Mock `MermaidBlock`, render `MarkdownText` inside `TextMessagePartProvider`, and assert:

```tsx
function renderMarkdown(text: string) {
    return render(
        <I18nProvider>
            <TextMessagePartProvider text={text}>
                <MarkdownText />
            </TextMessagePartProvider>
        </I18nProvider>,
    )
}

function rerenderMarkdown(rerender: ReturnType<typeof render>['rerender'], text: string): void {
    rerender(
        <I18nProvider>
            <TextMessagePartProvider text={text}>
                <MarkdownText />
            </TextMessagePartProvider>
        </I18nProvider>,
    )
}

it('routes lowercase mermaid fences to MermaidBlock', () => {
    renderMarkdown('```mermaid\nflowchart LR\nA-->B\n```')
    expect(screen.getByTestId('mermaid-block')).toHaveTextContent('flowchart LR')
})

it('keeps typescript and unlabeled fences on the existing code path', () => {
    const { rerender } = renderMarkdown('```ts\nconst x = 1\n```')
    expect(screen.queryByTestId('mermaid-block')).not.toBeInTheDocument()
    rerenderMarkdown(rerender, '```\nflowchart LR\n```')
    expect(screen.queryByTestId('mermaid-block')).not.toBeInTheDocument()
})

it('does not enable Mermaid in reasoning or generic MarkdownRenderer surfaces', () => {
    render(<MarkdownRenderer content={'```mermaid\nflowchart LR\n```'} />)
    expect(screen.queryByTestId('mermaid-block')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run integration test and verify RED**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid/mermaid-integration.test.tsx
```

Expected: lowercase Mermaid still renders as ordinary code, so the first test FAILS.

- [ ] **Step 3: Export a stable language map and register it only in `MarkdownText`**

```tsx
import type { MarkdownTextPrimitiveProps, SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { CodeBlock } from '@/components/CodeBlock'
import { MermaidBlock } from './MermaidBlock'
import { MermaidErrorBoundary } from './MermaidErrorBoundary'

function EmptyMermaidHeader() { return null }
function MermaidCodeBlock(props: SyntaxHighlighterProps) {
    return (
        <MermaidErrorBoundary resetKey={props.code} fallback={<CodeBlock code={props.code} language="text" />}>
            <MermaidBlock {...props} />
        </MermaidErrorBoundary>
    )
}

export const MERMAID_LANGUAGE_COMPONENTS = {
    mermaid: { CodeHeader: EmptyMermaidHeader, SyntaxHighlighter: MermaidCodeBlock },
} satisfies NonNullable<MarkdownTextPrimitiveProps['componentsByLanguage']>
```

Pass `componentsByLanguage={MERMAID_LANGUAGE_COMPONENTS}` only in the `MarkdownText()` component in `markdown-text.tsx`. Do not add it to `MarkdownRenderer`, `Reasoning`, or `EditorTabs`.

- [ ] **Step 4: Add security and built-in diagram smoke fixtures**

Create `web/src/components/assistant-ui/mermaid/mermaid-security.test.ts` and run the real renderer in jsdom with these fixtures:

```ts
const VALID_DIAGRAMS = [
    'flowchart LR\nA-->B',
    'sequenceDiagram\nA->>B: hello',
    'classDiagram\nclass User',
    'mindmap\n  root((HAPI))\n    CLI\n    Web',
]
const MALICIOUS_DIRECTIVE = `%%{init: {"securityLevel":"loose","themeCSS":"script{display:block}"}}%%
flowchart LR
A["<script>window.__owned=true</script>"]-->B
click A "javascript:alert(1)"`
```

Use unique IDs and inspect the actual returned SVG:

```ts
for (const [index, code] of VALID_DIAGRAMS.entries()) {
    it(`renders built-in diagram ${index + 1}`, async () => {
        const svg = await renderMermaid({ id: `valid-${index}`, code, theme: 'light' })
        expect(svg).toContain('<svg')
    })
}

it('does not allow source directives to weaken security or inject active content', async () => {
    const svg = await renderMermaid({ id: 'malicious', code: MALICIOUS_DIRECTIVE, theme: 'dark' })
    const host = document.createElement('div')
    host.innerHTML = svg
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('[onload], [onclick], [onerror]')).toBeNull()
    const unsafeLink = [...host.querySelectorAll('a')].find((link) =>
        (link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '').startsWith('javascript:'),
    )
    expect(unsafeLink).toBeUndefined()
})

it('rejects diagrams above text and edge limits without an injected error SVG', async () => {
    await expect(renderMermaid({
        id: 'too-long', code: `flowchart LR\nA[${'x'.repeat(50_001)}]`, theme: 'light',
    })).rejects.toBeDefined()
    const edges = Array.from({ length: 501 }, (_, index) => `N${index}-->N${index + 1}`).join('\n')
    await expect(renderMermaid({
        id: 'too-many-edges', code: `flowchart LR\n${edges}`, theme: 'light',
    })).rejects.toBeDefined()
    expect(document.querySelector('[id^="dtoo-long"], [id^="dtoo-many-edges"]')).toBeNull()
})
```

- [ ] **Step 5: Run all Mermaid and Markdown tests**

```bash
bun run --cwd web test -- src/components/assistant-ui/mermaid
```

Expected: every test under the Mermaid directory, including the new routing and security tests, PASS.

- [ ] **Step 6: Run the complete web test suite and typecheck**

```bash
bun run test:web
bun run typecheck:web
```

Expected: all web tests PASS; typecheck PASS.

- [ ] **Step 7: Verify all `SessionChat` surfaces in a development browser**

Run:

```bash
bun run dev
```

Use the existing session `7f7c57cd-3ffa-4ee2-a81a-4e634f297eb3` or a local fixture containing flowchart and sequence diagrams. Check normal session, Dashboard pinned compact, Team Session modal if available, Editor side chat, light/dark theme, source copy, mouse/trackpad, keyboard, fullscreen `Esc`, rejected/unsupported fullscreen, narrow width, and mobile emulation. Record unavailable physical Safari/iOS checks as residual risk; do not claim them as passed.

- [ ] **Step 8: Commit Task 5**

```bash
git add web/src/components/assistant-ui/mermaid/index.ts web/src/components/assistant-ui/mermaid/mermaid-integration.test.tsx web/src/components/assistant-ui/mermaid/mermaid-security.test.ts web/src/components/assistant-ui/markdown-text.tsx
git commit -m "feat(web): render Mermaid fences in chat"
```

---

### Task 6: Build, PWA, Embedded Asset, and Final Regression Verification

**Files:**
- Verify only: `web/dist/**` (ignored build output)
- Verify generator: `hub/scripts/generate-embedded-web-assets.ts`
- Do not hand-edit: `hub/src/web/embeddedAssets.generated.ts`

**Interfaces:**
- Consumes the complete feature from Tasks 1–5.
- Produces verification evidence and a clean source diff.

- [ ] **Step 1: Run focused tests, full repository typecheck, and full tests**

```bash
bun run test:web
bun typecheck
bun run test
```

Expected: all commands exit 0.

- [ ] **Step 2: Build the PWA and inspect chunk sizes**

```bash
bun run build:web
find web/dist/assets -maxdepth 1 -type f -printf '%s %p\n' | sort -nr | head -20
```

Expected: build exits 0; Mermaid-related dynamic chunks exist; no precached asset triggers Vite PWA's 4 MiB error. If a chunk exceeds 4 MiB, change import/chunking or evaluate Mermaid's supported smaller entry without weakening the approved diagram scope; do not raise the limit automatically.

- [ ] **Step 3: Verify service-worker precache references the dynamic chunks**

```bash
rg -n "mermaid|mindmap|flowchart|sequence" web/dist/sw.js web/dist/assets || true
```

Then inspect the generated Workbox manifest in `web/dist/sw.js` and confirm the new hashed JS chunks are included by URL/hash, even if filenames do not contain `mermaid`.

- [ ] **Step 4: Verify embedded asset generation includes every web build file**

```bash
bun run --cwd hub generate:embedded-web-assets
git diff -- hub/src/web/embeddedAssets.generated.ts
```

Expected: generated manifest includes all new `web/dist` chunks. This is verification output; always restore the generated source file after confirming coverage because this feature does not commit hashed build artifacts:

```bash
git restore hub/src/web/embeddedAssets.generated.ts
```

- [ ] **Step 5: Review the actual source diff and run whitespace checks**

```bash
git status --short
git diff --check
BASE_COMMIT=$(git log --format=%H --grep='docs: add Mermaid preview implementation plan' -1)
git diff --stat "$BASE_COMMIT"..HEAD
git diff "$BASE_COMMIT"..HEAD -- web/src/components/assistant-ui web/src/components/icons.tsx web/src/index.css web/src/lib/locales web/package.json bun.lock
```

Expected: no unrelated files, no unscoped CSS, no hub/CLI/database/protocol changes, and no generated build output staged.

- [ ] **Step 6: Confirm the worktree contains no verification artifacts**

```bash
git status --short
```

Expected: no `web/dist` output, generated embedded manifest change, or unrelated file is staged. Any real correction discovered in Steps 1–5 must be applied with its paired failing regression test, rerun through Steps 1–5, and committed as `fix(web): harden Mermaid preview integration` with explicit file paths from that correction.

## Completion Evidence Required

- Focused renderer/hook/canvas/block/integration tests: exact commands and pass counts.
- `bun run test:web`, `bun typecheck`, and `bun run test`: exit codes.
- `bun run build:web`: exit code and largest relevant chunk sizes.
- Browser checks actually performed, separated from Safari/iOS checks not available.
- Final code map from actual diff.
- Residual risks: browser-native fullscreen compatibility, PWA portrait orientation, main-thread Mermaid layout, and physical touch/pinch coverage.
