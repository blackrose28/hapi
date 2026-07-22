import { useAssistantState } from '@assistant-ui/react'
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { useEffect, useId, useRef, useState } from 'react'
import { CodeBlock } from '@/components/CodeBlock'
import { useTheme } from '@/hooks/useTheme'
import { useTranslation } from '@/lib/use-translation'
import { MermaidCanvas, type MermaidCanvasHandle } from './MermaidCanvas'
import { MermaidErrorBoundary } from './MermaidErrorBoundary'
import { MermaidToolbar } from './MermaidToolbar'
import { useMermaidRender } from './use-mermaid-render'

export function MermaidBlock(props: SyntaxHighlighterProps) {
    const streaming = useAssistantState(({ part }) => part.status?.type === 'running')
    const { colorScheme } = useTheme()
    const { t } = useTranslation()
    const generatedId = useId().replace(/:/g, '')
    const [mode, setMode] = useState<'preview' | 'source'>('preview')
    const [retryKey, setRetryKey] = useState(0)
    const [fullscreen, setFullscreen] = useState(false)
    const [fullscreenStatus, setFullscreenStatus] = useState<string | null>(null)
    const [scale, setScale] = useState(1)
    const canvasRef = useRef<MermaidCanvasHandle>(null)
    const blockRef = useRef<HTMLDivElement>(null)
    const fullscreenSupported = typeof HTMLElement !== 'undefined'
        && typeof HTMLElement.prototype.requestFullscreen === 'function'
    const render = useMermaidRender({
        id: `mermaid-${generatedId}`,
        code: props.code,
        theme: colorScheme,
        streaming,
        retryKey,
    })
    const showSource = mode === 'source' || render.error !== null

    useEffect(() => {
        const onFullscreenChange = () => {
            setFullscreen(document.fullscreenElement === blockRef.current)
        }
        document.addEventListener('fullscreenchange', onFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
    }, [])

    const toggleFullscreen = () => {
        setFullscreenStatus(null)
        if (fullscreen) {
            try {
                const exit = document.exitFullscreen?.()
                if (exit) {
                    void exit.catch(() => setFullscreenStatus(t('mermaid.fullscreenUnavailable')))
                }
            } catch {
                setFullscreenStatus(t('mermaid.fullscreenUnavailable'))
            }
            return
        }

        const block = blockRef.current
        if (!block?.requestFullscreen) {
            setFullscreenStatus(t('mermaid.fullscreenUnavailable'))
            return
        }
        try {
            const request = block.requestFullscreen()
            void request.catch(() => setFullscreenStatus(t('mermaid.fullscreenUnavailable')))
        } catch {
            setFullscreenStatus(t('mermaid.fullscreenUnavailable'))
        }
    }

    const source = (
        <div className="mermaid-preview__source" data-mermaid-source>
            <CodeBlock code={props.code} language="text" showCopyButton={false} />
        </div>
    )
    const content = showSource ? source : render.svg ? (
        <MermaidCanvas
            ref={canvasRef}
            svg={render.svg}
            fullscreen={fullscreen}
            ariaLabel={t('mermaid.canvas')}
            onScaleChange={setScale}
        />
    ) : (
        <div className="mermaid-preview__status" role="status">{t('mermaid.loading')}</div>
    )

    return (
        <div ref={blockRef} className="mermaid-preview" data-mermaid-block>
            <div className="mermaid-preview__header mermaid-panzoom-exclude">
                <div className="mermaid-preview__identity">
                    <span className="mermaid-preview__title">Mermaid</span>
                    <span className="mermaid-preview__badge">{t('mermaid.preview')}</span>
                </div>
                <MermaidToolbar
                    code={props.code}
                    sourceMode={mode === 'source'}
                    fullscreen={fullscreen}
                    fullscreenSupported={fullscreenSupported}
                    scale={scale}
                    renderFailed={render.error !== null}
                    onToggleSource={() => setMode((current) => current === 'preview' ? 'source' : 'preview')}
                    onZoomIn={() => canvasRef.current?.zoomIn()}
                    onZoomOut={() => canvasRef.current?.zoomOut()}
                    onFit={() => canvasRef.current?.fit()}
                    onToggleFullscreen={toggleFullscreen}
                />
            </div>
            {render.error ? (
                <div className="mermaid-preview__error mermaid-panzoom-exclude">
                    <span>{t('mermaid.renderError')}</span>
                    <button type="button" onClick={() => setRetryKey((key) => key + 1)}>
                        {t('mermaid.retry')}
                    </button>
                </div>
            ) : null}
            {fullscreenStatus ? (
                <div className="mermaid-preview__notice mermaid-panzoom-exclude">
                    <span role="status">{fullscreenStatus}</span>
                    <button
                        type="button"
                        aria-label={t('button.dismiss')}
                        onClick={() => setFullscreenStatus(null)}
                    >
                        ×
                    </button>
                </div>
            ) : null}
            <MermaidErrorBoundary
                resetKey={`${props.code}:${colorScheme}:${retryKey}`}
                fallback={source}
            >
                {content}
            </MermaidErrorBoundary>
        </div>
    )
}
