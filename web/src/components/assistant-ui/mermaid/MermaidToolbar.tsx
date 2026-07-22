import {
    CodeIcon,
    CopyIcon,
    ExitFullscreenIcon,
    FitIcon,
    FullscreenIcon,
    MinusIcon,
    PlusIcon,
} from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation } from '@/lib/use-translation'

type Props = {
    code: string
    sourceMode: boolean
    fullscreen: boolean
    fullscreenSupported: boolean
    scale: number
    renderFailed: boolean
    onToggleSource(): void
    onZoomIn(): void
    onZoomOut(): void
    onFit(): void
    onToggleFullscreen(): void
}

function Action(props: {
    label: string
    children: React.ReactNode
    onClick(): void
    disabled?: boolean
}) {
    return (
        <button
            type="button"
            className="mermaid-preview__action mermaid-panzoom-exclude"
            aria-label={props.label}
            title={props.label}
            onClick={props.onClick}
            disabled={props.disabled}
        >
            {props.children}
        </button>
    )
}

export function MermaidToolbar(props: Props) {
    const { t } = useTranslation()
    const { copy } = useCopyToClipboard()
    const diagramControlsDisabled = props.sourceMode || props.renderFailed
    const fullscreenLabel = props.fullscreenSupported
        ? t(props.fullscreen ? 'mermaid.exitFullscreen' : 'mermaid.enterFullscreen')
        : t('mermaid.fullscreenUnavailable')

    return (
        <div className="mermaid-preview__toolbar" role="toolbar" aria-label="Mermaid">
            {!props.renderFailed ? (
                <Action
                    label={t(props.sourceMode ? 'mermaid.viewDiagram' : 'mermaid.viewSource')}
                    onClick={props.onToggleSource}
                >
                    <CodeIcon />
                    <span className="mermaid-preview__label">
                        {t(props.sourceMode ? 'mermaid.viewDiagram' : 'mermaid.viewSource')}
                    </span>
                </Action>
            ) : null}
            <Action label={t('mermaid.copySource')} onClick={() => { void copy(props.code) }}>
                <CopyIcon />
            </Action>
            {!diagramControlsDisabled ? <>
                <Action label={t('mermaid.zoomOut')} onClick={props.onZoomOut}>
                    <MinusIcon />
                </Action>
                <span className="mermaid-preview__scale" aria-live="polite">
                    {Math.round(props.scale * 100)}%
                </span>
                <Action label={t('mermaid.zoomIn')} onClick={props.onZoomIn}>
                    <PlusIcon />
                </Action>
                <Action label={t('mermaid.fit')} onClick={props.onFit}>
                    <FitIcon />
                    <span className="mermaid-preview__label">{t('mermaid.fit')}</span>
                </Action>
            </> : null}
            <Action
                label={fullscreenLabel}
                onClick={props.onToggleFullscreen}
                disabled={!props.fullscreenSupported}
            >
                {props.fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </Action>
        </div>
    )
}
