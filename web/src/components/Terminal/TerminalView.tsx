import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import { ensureBuiltinFontLoaded, getFontProvider } from '@/lib/terminalFont'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { getCompactTerminalFontSize, getInitialTerminalFontSize } from '@/hooks/useTerminalFontSize'
import { MobileTerminalInteractionOverlay } from './MobileTerminalInteractionOverlay'
import { EMPTY_TERMINAL_SEARCH_STATE, type TerminalSearchState } from './terminalSearch'
import { useMobileTerminalInteraction } from './useMobileTerminalInteraction'
import { useTerminalSearchAddon } from './useTerminalSearchAddon'

function resolveThemeColors(): { background: string; foreground: string; selectionBackground: string } {
    const styles = getComputedStyle(document.documentElement)
    const background = styles.getPropertyValue('--app-bg').trim() || '#000000'
    const foreground = styles.getPropertyValue('--app-fg').trim() || '#ffffff'
    const selectionBackground = styles
        .getPropertyValue('--app-terminal-selection-bg')
        .trim() || 'rgba(99, 102, 241, 0.38)'
    return { background, foreground, selectionBackground }
}

export function TerminalView(props: {
    onMount?: (terminal: Terminal) => void
    onResize?: (cols: number, rows: number) => void
    className?: string
    compactFontSize?: boolean
    mobileInteractionEnabled?: boolean
    dismissMobileInteraction?: boolean
    searchActive?: boolean
    onSearchStateChange?: (state: TerminalSearchState) => void
}) {
    const mobile = useMediaQuery('(max-width: 1023px)')
    const [terminal, setTerminal] = useState<Terminal | null>(null)
    const [root, setRoot] = useState<HTMLDivElement | null>(null)
    const xtermHostRef = useRef<HTMLDivElement | null>(null)
    const onMountRef = useRef(props.onMount)
    const onResizeRef = useRef(props.onResize)
    const interaction = useMobileTerminalInteraction({
        terminal,
        root,
        mobile,
        enabled: props.mobileInteractionEnabled ?? true,
        dismissRequested: props.dismissMobileInteraction ?? false,
    })
    const searchState = useTerminalSearchAddon({
        terminal,
        active: props.searchActive ?? false,
    })

    useEffect(() => {
        onMountRef.current = props.onMount
    }, [props.onMount])

    useEffect(() => {
        onResizeRef.current = props.onResize
    }, [props.onResize])

    useEffect(() => {
        props.onSearchStateChange?.(searchState)
    }, [props.onSearchStateChange, searchState])

    useEffect(() => {
        return () => {
            props.onSearchStateChange?.(EMPTY_TERMINAL_SEARCH_STATE)
        }
    }, [props.onSearchStateChange, terminal])

    useEffect(() => {
        const xtermHost = xtermHostRef.current
        if (!xtermHost) return

        const abortController = new AbortController()

        const fontProvider = getFontProvider()
        const fontSize = props.compactFontSize
            ? getCompactTerminalFontSize()
            : getInitialTerminalFontSize()
        const { background, foreground, selectionBackground } = resolveThemeColors()
        const terminal = new Terminal({
            allowProposedApi: true,
            cursorBlink: true,
            fontFamily: fontProvider.getFontFamily(),
            fontSize,
            theme: {
                background,
                foreground,
                cursor: foreground,
                selectionBackground
            },
            convertEol: true,
            customGlyphs: true
        })

        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon()
        const canvasAddon = new CanvasAddon()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(webLinksAddon)
        terminal.loadAddon(canvasAddon)
        terminal.open(xtermHost)
        setTerminal(terminal)

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                fitAddon.fit()
                onResizeRef.current?.(terminal.cols, terminal.rows)
            })
        })
        observer.observe(xtermHost)

        const refreshFont = (forceRemeasure = false) => {
            if (abortController.signal.aborted) return
            const nextFamily = fontProvider.getFontFamily()

            if (forceRemeasure && terminal.options.fontFamily === nextFamily) {
                terminal.options.fontFamily = `${nextFamily}, "__hapi_font_refresh__"`
                requestAnimationFrame(() => {
                    if (abortController.signal.aborted) return
                    terminal.options.fontFamily = nextFamily
                    if (terminal.rows > 0) {
                        terminal.refresh(0, terminal.rows - 1)
                    }
                    fitAddon.fit()
                    onResizeRef.current?.(terminal.cols, terminal.rows)
                })
                return
            }

            terminal.options.fontFamily = nextFamily
            if (terminal.rows > 0) {
                terminal.refresh(0, terminal.rows - 1)
            }
            fitAddon.fit()
            onResizeRef.current?.(terminal.cols, terminal.rows)
        }

        void ensureBuiltinFontLoaded().then(loaded => {
            if (!loaded) return
            refreshFont(true)
        })

        // Cleanup on abort
        abortController.signal.addEventListener('abort', () => {
            observer.disconnect()
            fitAddon.dispose()
            webLinksAddon.dispose()
            canvasAddon.dispose()
            terminal.dispose()
            setTerminal(null)
        })

        requestAnimationFrame(() => {
            fitAddon.fit()
            onResizeRef.current?.(terminal.cols, terminal.rows)
        })
        onMountRef.current?.(terminal)

        return () => abortController.abort()
    }, [props.compactFontSize])

    return (
        <div
            ref={setRoot}
            className={`relative h-full w-full overflow-hidden ${props.className ?? ''}`}
        >
            <div ref={xtermHostRef} className="h-full w-full" />
            <MobileTerminalInteractionOverlay {...interaction.overlayProps} />
        </div>
    )
}
