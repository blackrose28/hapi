import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { MarkdownTextPrimitive, type MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'
import { TextMessagePartProvider } from '@assistant-ui/react'
import type { EditorTab } from '@/hooks/useEditorState'
import type { ApiClient, ApiError } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from '@/components/ui/app-dialog'
import { useEditorFile } from '@/hooks/queries/useEditorFile'
import { MARKDOWN_PLUGINS, MARKDOWN_REHYPE_PLUGINS } from '@/components/assistant-ui/markdown-text'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'

const editorScrollTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: 'calc(13px * var(--app-font-scale, 1))'
    },
    '.cm-scroller': {
        overflow: 'auto'
    }
})

type LanguageExtension =
    | ReturnType<typeof javascript>
    | ReturnType<typeof json>
    | ReturnType<typeof css>
    | ReturnType<typeof html>
    | ReturnType<typeof markdown>
    | ReturnType<typeof python>
    | ReturnType<typeof rust>
    | ReturnType<typeof go>

function getLanguageExtension(filePath: string): LanguageExtension | null {
    const ext = filePath.split('.').pop()?.toLowerCase()
    switch (ext) {
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
            return javascript({ jsx: true, typescript: false })
        case 'ts':
        case 'tsx':
        case 'mts':
        case 'cts':
            return javascript({ jsx: true, typescript: true })
        case 'json':
            return json()
        case 'css':
        case 'scss':
        case 'less':
            return css()
        case 'html':
        case 'htm':
            return html()
        case 'md':
        case 'mdx':
        case 'markdown':
            return markdown()
        case 'py':
            return python()
        case 'rs':
            return rust()
        case 'go':
            return go()
        default:
            return null
    }
}

function getFileExtensionLabel(filePath: string): string {
    const ext = filePath.split('.').pop()
    return ext ? ext.toUpperCase() : 'TEXT'
}

type FilePreviewType = 'markdown' | 'image' | 'code'

function getFilePreviewType(filePath: string): FilePreviewType {
    const ext = filePath.split('.').pop()?.toLowerCase()
    switch (ext) {
        case 'md':
        case 'mdx':
        case 'markdown':
            return 'markdown'
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'svg':
        case 'webp':
            return 'image'
        default:
            return 'code'
    }
}

export interface EditorSelectionInfo {
    from: number
    to: number
    text: string
    startLine: number
    endLine: number
    /** Pixel coords within the editor container */
    top: number
    right: number
}

function useCodeMirror(
    containerRef: React.RefObject<HTMLDivElement | null>,
    content: string | null,
    filePath: string | null,
    onChange?: (content: string) => void
): { selection: EditorSelectionInfo | null; clearSelection: () => void } {
    const viewRef = useRef<EditorView | null>(null)
    const suppressChangeRef = useRef(false)
    const contentReady = content !== null
    const [selection, setSelection] = useState<EditorSelectionInfo | null>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container || !contentReady) return

        if (viewRef.current) {
            viewRef.current.destroy()
            viewRef.current = null
        }

        const langExt = filePath ? getLanguageExtension(filePath) : null
        const extensions = [
            basicSetup,
            oneDark,
            editorScrollTheme,
            EditorView.editable.of(true),
            EditorView.updateListener.of((update) => {
                if (suppressChangeRef.current) return
                if (update.docChanged) {
                    onChange?.(update.state.doc.toString())
                }
                const sel = update.state.selection.main
                if (!sel.empty) {
                    const doc = update.state.doc
                    const text = doc.sliceString(sel.from, sel.to)
                    const startLine = doc.lineAt(sel.from).number
                    const endLine = doc.lineAt(sel.to).number
                    const container = containerRef.current
                    if (container) {
                        const fromCoords = update.view.coordsAtPos(sel.from)
                        const toCoords = update.view.coordsAtPos(sel.to)
                        const containerRect = container.getBoundingClientRect()
                        if (fromCoords && toCoords) {
                            setSelection({
                                from: sel.from,
                                to: sel.to,
                                text,
                                startLine,
                                endLine,
                                top: fromCoords.top - containerRect.top + container.scrollTop,
                                right: toCoords.right - containerRect.left,
                            })
                            return
                        }
                    }
                    setSelection({ from: sel.from, to: sel.to, text, startLine, endLine, top: 0, right: 0 })
                } else {
                    setSelection(null)
                }
            }),
        ]
        if (langExt) {
            extensions.push(langExt)
        }

        const view = new EditorView({
            doc: content ?? '',
            extensions,
            parent: container,
        })
        viewRef.current = view
        container.style.height = '100%'

        return () => {
            view.destroy()
            if (viewRef.current === view) {
                viewRef.current = null
            }
            setSelection(null)
        }
    }, [containerRef, filePath, contentReady, onChange])

    const clearSelection = useCallback(() => {
        const view = viewRef.current
        if (view) {
            view.dispatch({ selection: { anchor: view.state.selection.main.head } })
        }
        setSelection(null)
    }, [])

    useEffect(() => {
        const view = viewRef.current
        if (!view || content === null) return
        const currentContent = view.state.doc.toString()
        if (currentContent !== content) {
            suppressChangeRef.current = true
            try {
                view.dispatch({
                    changes: {
                        from: 0,
                        to: view.state.doc.length,
                        insert: content
                    }
                })
            } finally {
                suppressChangeRef.current = false
            }
        }
    }, [content])

    return { selection, clearSelection }
}

function TextFileContent(props: {
    api: ApiClient | null
    machineId: string | null
    tabId: string
    isDirty: boolean
    filePath: string
    viewMode?: 'source' | 'preview'
    onContentLoaded: (tabId: string, content: string) => void
    onContentChanged: (tabId: string, content: string) => void
    onAddSelectionToChat?: (filePath: string, startLine: number, endLine: number, content: string) => void
}) {
    const containerRef = useRef<HTMLDivElement>(null)
    const tab = props.tabId
    const { content, isLoading, error } = useEditorFile(
        props.api,
        props.machineId,
        props.filePath,
        { refetchInterval: props.isDirty ? false : 2_000 }
    )
    const handleChange = useCallback((nextContent: string) => {
        props.onContentChanged(tab, nextContent)
    }, [props.onContentChanged, tab])
    const { selection, clearSelection } = useCodeMirror(containerRef, content, props.filePath, handleChange)
    const [mouseUpPos, setMouseUpPos] = useState<{ x: number; y: number } | null>(null)
    const [markdownError, setMarkdownError] = useState(false)

    const handleAddSelection = useCallback(() => {
        if (selection && props.onAddSelectionToChat) {
            props.onAddSelectionToChat(props.filePath, selection.startLine, selection.endLine, selection.text)
        }
        clearSelection()
        setMouseUpPos(null)
    }, [selection, clearSelection, props])

    useEffect(() => {
        if (content !== null) {
            props.onContentLoaded(tab, content)
        }
    }, [content, props.onContentLoaded, tab])

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect()
        setMouseUpPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }, [])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full text-xs text-[var(--app-hint)]">
                Loading...
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full text-xs text-red-500 p-4">
                {error}
            </div>
        )
    }

    const showPreview = props.viewMode === 'preview'
    const showSource = !showPreview

    return (
        <div className="h-full min-h-0 w-full overflow-hidden relative">
            {/* CodeMirror: hidden when in preview mode, kept mounted to preserve state */}
            <div
                data-testid="codemirror-host"
                className="h-full min-h-0 w-full overflow-hidden relative"
                style={{ display: showSource ? '' : 'none' }}
                onMouseUp={handleMouseUp}
            >
                <div ref={containerRef} className="h-full min-h-0 w-full" />
                {selection && mouseUpPos && props.onAddSelectionToChat && (
                    <button
                        type="button"
                        aria-label="Add selection to chat"
                        className="absolute z-20 rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300 shadow-md hover:bg-violet-500 hover:text-white hover:border-violet-400 transition-colors"
                        style={{
                            top: Math.max(0, mouseUpPos.y - 28) + 'px',
                            left: Math.max(0, mouseUpPos.x - 45) + 'px',
                        }}
                        onClick={handleAddSelection}
                    >
                        Add to chat
                    </button>
                )}
            </div>

            {/* Markdown preview */}
            {showPreview && content !== null && !markdownError && (
                <MarkdownPreview
                    content={content}
                    onError={() => setMarkdownError(true)}
                />
            )}

            {showPreview && markdownError && (
                <div className="h-full min-h-0 overflow-auto p-4">
                    <div className="rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400 mb-3">
                        Markdown render failed — showing raw text
                    </div>
                    <pre className="text-xs whitespace-pre-wrap break-words text-[var(--app-fg)]">{content}</pre>
                </div>
            )}
        </div>
    )
}

class MarkdownErrorBoundary extends React.Component<
    { children: React.ReactNode; onError: () => void },
    { hasError: boolean }
> {
    constructor(props: { children: React.ReactNode; onError: () => void }) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch() {
        this.props.onError()
    }

    render() {
        if (this.state.hasError) return null
        return this.props.children
    }
}

function MarkdownPreview(props: { content: string; onError: () => void }) {
    return (
        <MarkdownErrorBoundary onError={props.onError}>
            <div className="h-full min-h-0 overflow-auto">
                <div className="max-w-3xl mx-auto p-4">
                    <TextMessagePartProvider text={props.content}>
                        <MarkdownTextPrimitive
                            remarkPlugins={MARKDOWN_PLUGINS}
                            rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                            components={{
                                SyntaxHighlighter,
                                h1: ({ ...rest }: React.ComponentPropsWithoutRef<'h1'>) => <h1 className="text-lg font-bold mt-5 mb-2 text-[var(--app-fg)]" {...rest} />,
                                h2: ({ ...rest }: React.ComponentPropsWithoutRef<'h2'>) => <h2 className="text-base font-bold mt-4 mb-2 text-[var(--app-fg)]" {...rest} />,
                                h3: ({ ...rest }: React.ComponentPropsWithoutRef<'h3'>) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-[var(--app-fg)]" {...rest} />,
                                h4: ({ ...rest }: React.ComponentPropsWithoutRef<'h4'>) => <h4 className="text-sm font-semibold mt-3 mb-1 text-[var(--app-fg)]" {...rest} />,
                                h5: ({ ...rest }: React.ComponentPropsWithoutRef<'h5'>) => <h5 className="text-sm font-semibold mt-2 mb-1 text-[var(--app-fg)]" {...rest} />,
                                h6: ({ ...rest }: React.ComponentPropsWithoutRef<'h6'>) => <h6 className="text-sm font-semibold mt-2 mb-1 text-[var(--app-fg)]" {...rest} />,
                                p: ({ ...rest }: React.ComponentPropsWithoutRef<'p'>) => <p className="leading-relaxed mb-3 text-[var(--app-fg)]" {...rest} />,
                                strong: ({ ...rest }: React.ComponentPropsWithoutRef<'strong'>) => <strong className="font-semibold" {...rest} />,
                                em: ({ ...rest }: React.ComponentPropsWithoutRef<'em'>) => <em className="italic" {...rest} />,
                                a: ({ ...rest }: React.ComponentPropsWithoutRef<'a'>) => <a className="text-[var(--app-link)] underline" target={rest.href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer" {...rest} />,
                                blockquote: ({ ...rest }: React.ComponentPropsWithoutRef<'blockquote'>) => <blockquote className="border-l-4 border-[var(--app-border)] pl-4 opacity-85 my-3" {...rest} />,
                                ul: ({ ...rest }: React.ComponentPropsWithoutRef<'ul'>) => <ul className="list-disc pl-6 mb-3" {...rest} />,
                                ol: ({ ...rest }: React.ComponentPropsWithoutRef<'ol'>) => <ol className="list-decimal pl-6 mb-3" {...rest} />,
                                li: ({ ...rest }: React.ComponentPropsWithoutRef<'li'>) => <li className="mb-1" {...rest} />,
                                hr: ({ ...rest }: React.ComponentPropsWithoutRef<'hr'>) => <hr className="border-[var(--app-divider)] my-4" {...rest} />,
                                table: ({ ...rest }: React.ComponentPropsWithoutRef<'table'>) => <div className="max-w-full overflow-x-auto mb-3"><table className="w-full border-collapse" {...rest} /></div>,
                                thead: ({ ...rest }: React.ComponentPropsWithoutRef<'thead'>) => <thead {...rest} />,
                                tbody: ({ ...rest }: React.ComponentPropsWithoutRef<'tbody'>) => <tbody {...rest} />,
                                tr: ({ ...rest }: React.ComponentPropsWithoutRef<'tr'>) => <tr {...rest} />,
                                th: ({ ...rest }: React.ComponentPropsWithoutRef<'th'>) => <th className="border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1 text-left font-semibold" {...rest} />,
                                td: ({ ...rest }: React.ComponentPropsWithoutRef<'td'>) => <td className="border border-[var(--app-border)] px-2 py-1" {...rest} />,
                                img: ({ ...rest }: React.ComponentPropsWithoutRef<'img'>) => <img className="max-w-full rounded" {...rest} />,
                            } satisfies MarkdownTextPrimitiveProps['components']}
                        />
                    </TextMessagePartProvider>
                </div>
            </div>
        </MarkdownErrorBoundary>
    )
}

function ImageFileContent(props: {
    api: ApiClient | null
    machineId: string | null
    filePath: string
    tabId: string
}) {
    const [state, setState] = useState<'loading' | 'loaded' | 'oversize' | 'error'>('loading')
    const [blobUrl, setBlobUrl] = useState<string | null>(null)
    const [metadata, setMetadata] = useState<{ size: number; type: string } | null>(null)
    const [width, setWidth] = useState<number | null>(null)
    const [height, setHeight] = useState<number | null>(null)

    useEffect(() => {
        const abort = new AbortController()
        let url: string | null = null

        const load = async () => {
            setState('loading')
            setBlobUrl(null)
            setMetadata(null)
            setWidth(null)
            setHeight(null)

            if (!props.api || !props.machineId) {
                setState('error')
                return
            }

            try {
                const blob = await props.api.getEditorFileRawBlob(props.machineId, props.filePath)
                if (abort.signal.aborted) return

                url = URL.createObjectURL(blob)
                setBlobUrl(url)
                setMetadata({ size: blob.size, type: blob.type })
                setState('loaded')
            } catch (err) {
                if (abort.signal.aborted) return
                const status = (err as ApiError).status
                if (status === 413) {
                    setState('oversize')
                } else {
                    setState('error')
                }
            }
        }

        load()

        return () => {
            abort.abort()
            if (url) URL.revokeObjectURL(url)
        }
    }, [props.api, props.machineId, props.filePath])

    const handleImageError = useCallback(() => {
        setState('error')
    }, [])

    const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget
        setWidth(img.naturalWidth)
        setHeight(img.naturalHeight)
    }, [])

    function formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    const fileName = props.filePath.split('/').filter(Boolean).pop() || props.filePath

    if (state === 'loading') {
        return (
            <div className="flex items-center justify-center h-full text-xs text-[var(--app-hint)]">
                Loading...
            </div>
        )
    }

    if (state === 'oversize') {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-[var(--app-hint)] p-4">
                <span className="text-2xl opacity-50">⚠️</span>
                <span>File too large to preview</span>
                {metadata && <span className="text-[10px] opacity-60">{formatSize(metadata.size)}</span>}
            </div>
        )
    }

    if (state === 'error') {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-red-400 p-4">
                <span className="text-2xl opacity-50">🖼</span>
                <span>{fileName}</span>
                <span>Could not load image</span>
            </div>
        )
    }

    return (
        <div className="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--app-subtle-bg)]">
            <div className="flex items-center gap-2 shrink-0 border-b border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1.5 text-xs text-[var(--app-hint)]">
                <span className="text-[var(--app-fg)] font-medium">{fileName}</span>
                {metadata && (
                    <>
                        <span className="text-[var(--app-hint)]">·</span>
                        <span>{formatSize(metadata.size)}</span>
                    </>
                )}
                {width !== null && height !== null && (
                    <>
                        <span className="text-[var(--app-hint)]">·</span>
                        <span>{width} × {height}</span>
                    </>
                )}
            </div>
            <div className="min-h-0 flex-1 flex items-center justify-center overflow-auto">
                {blobUrl && (
                    <img
                        src={blobUrl}
                        alt={fileName}
                        className="max-w-full max-h-full object-contain"
                        onLoad={handleImageLoad}
                        onError={handleImageError}
                    />
                )}
            </div>
        </div>
    )
}

function FileTabContent(props: {
    api: ApiClient | null
    machineId: string | null
    tabId: string
    isDirty: boolean
    filePath: string
    viewMode?: 'source' | 'preview'
    previewType?: FilePreviewType
    onContentLoaded: (tabId: string, content: string) => void
    onContentChanged: (tabId: string, content: string) => void
    onAddSelectionToChat?: (filePath: string, startLine: number, endLine: number, content: string) => void
}) {
    if (props.previewType === 'image') {
        return (
            <ImageFileContent
                api={props.api}
                machineId={props.machineId}
                filePath={props.filePath}
                tabId={props.tabId}
            />
        )
    }

    return (
        <TextFileContent
            api={props.api}
            machineId={props.machineId}
            tabId={props.tabId}
            isDirty={props.isDirty}
            filePath={props.filePath}
            viewMode={props.viewMode}
            onContentLoaded={props.onContentLoaded}
            onContentChanged={props.onContentChanged}
            onAddSelectionToChat={props.onAddSelectionToChat}
        />
    )
}

export function EditorTabs(props: {
    api: ApiClient | null
    machineId: string | null
    tabs: EditorTab[]
    activeTabId: string | null
    onSelectTab: (tabId: string) => void
    onCloseTab: (tabId: string) => void
    onNewFile: () => void
    onDirtyChange?: (tabId: string, dirty: boolean) => void
    onSaveFile?: (path: string, content: string) => Promise<void>
    onAddSelectionToChat?: (filePath: string, startLine: number, endLine: number, content: string) => void
    setTabViewMode?: (tabId: string, mode: 'source' | 'preview') => void
    mobileMode?: boolean
    saveRef: React.MutableRefObject<(() => Promise<void>) | null>
}) {
    const fileContentsRef = useRef<Map<string, string>>(new Map())
    const [savingTabId, setSavingTabId] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [pendingCloseTab, setPendingCloseTab] = useState<EditorTab | null>(null)
    const [pendingCloseError, setPendingCloseError] = useState<string | null>(null)
    const fileTabs = useMemo(
        () => props.tabs.filter((tab) => tab.type === 'file'),
        [props.tabs]
    )
    const activeTab = useMemo(
        () => fileTabs.find((tab) => tab.id === props.activeTabId) ?? fileTabs[fileTabs.length - 1] ?? null,
        [props.activeTabId, fileTabs]
    )

    useEffect(() => {
        const openTabIds = new Set(fileTabs.map((tab) => tab.id))
        for (const tabId of fileContentsRef.current.keys()) {
            if (!openTabIds.has(tabId)) {
                fileContentsRef.current.delete(tabId)
            }
        }
    }, [fileTabs])

    useEffect(() => {
        if (pendingCloseTab && !fileTabs.some((tab) => tab.id === pendingCloseTab.id)) {
            setPendingCloseTab(null)
            setPendingCloseError(null)
        }
    }, [fileTabs, pendingCloseTab])

    const handleContentLoaded = useCallback((tabId: string, content: string) => {
        fileContentsRef.current.set(tabId, content)
    }, [])

    const handleContentChanged = useCallback((tabId: string, content: string) => {
        fileContentsRef.current.set(tabId, content)
        props.onDirtyChange?.(tabId, true)
    }, [props.onDirtyChange])

    const saveFileTab = useCallback(async (tab: EditorTab) => {
        if (tab.type !== 'file' || !tab.path || !tab.dirty) {
            return
        }

        const content = fileContentsRef.current.get(tab.id) ?? ''
        const saveFile = props.onSaveFile ?? (async (path: string, nextContent: string) => {
            if (!props.api || !props.machineId) {
                throw new Error('Cannot save file: API or machine is not available')
            }
            const response = await props.api.writeEditorFile(props.machineId, path, nextContent)
            if (!response.success) {
                throw new Error(response.error ?? 'Failed to save file')
            }
        })

        setSavingTabId(tab.id)
        setSaveError(null)
        await saveFile(tab.path, content)
        props.onDirtyChange?.(tab.id, false)
        setSavingTabId(null)
    }, [props])

    const saveActiveFile = useCallback(async () => {
        if (!activeTab) {
            return
        }

        try {
            await saveFileTab(activeTab)
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save file')
        } finally {
            setSavingTabId(null)
        }
    }, [activeTab, saveFileTab])

    const requestCloseTab = useCallback((tab: EditorTab) => {
        if (props.mobileMode && tab.dirty) {
            setPendingCloseTab(tab)
            setPendingCloseError(null)
            return
        }
        props.onCloseTab(tab.id)
    }, [props])

    const discardPendingClose = useCallback(() => {
        if (!pendingCloseTab) return
        props.onCloseTab(pendingCloseTab.id)
        setPendingCloseTab(null)
        setPendingCloseError(null)
    }, [pendingCloseTab, props])

    const savePendingClose = useCallback(async () => {
        if (!pendingCloseTab) return

        setPendingCloseError(null)
        try {
            await saveFileTab(pendingCloseTab)
            props.onCloseTab(pendingCloseTab.id)
            setPendingCloseTab(null)
        } catch (error) {
            setPendingCloseError(error instanceof Error ? error.message : 'Failed to save file')
        } finally {
            setSavingTabId(null)
        }
    }, [pendingCloseTab, props, saveFileTab])

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                void saveActiveFile()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [saveActiveFile])

    useEffect(() => {
        props.saveRef.current = saveActiveFile
        return () => { props.saveRef.current = null }
    }, [saveActiveFile, props.saveRef])

    return (
        <div data-testid="editor-tabs-root" className="flex h-full min-h-0 flex-col overflow-hidden">
            <div
                data-testid="editor-tabs-tabbar"
                className={`flex items-center border-b border-[var(--app-border)] overflow-x-auto shrink-0 ${
                    props.mobileMode ? 'bg-[var(--app-secondary-bg)]' : 'bg-[var(--app-subtle-bg)]'
                }`}
            >
                {fileTabs.map((tab) => {
                    const isActive = tab.id === props.activeTabId
                    return (
                        <div
                            key={tab.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`Select tab ${tab.label}`}
                            className={`flex items-center gap-1.5 ${props.mobileMode ? 'px-2' : 'px-3'} py-1.5 text-xs border-r border-[var(--app-border)] whitespace-nowrap cursor-pointer transition-colors ${
                                isActive
                                    ? 'bg-[var(--app-bg)] border-b-2 border-b-[#6366f1] text-[#818cf8]'
                                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'
                            }`}
                            onClick={() => props.onSelectTab(tab.id)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    props.onSelectTab(tab.id)
                                }
                            }}
                        >
                            {tab.path && <FileIcon fileName={tab.path} size={13} />}
                            <span className="truncate max-w-[160px]">{tab.label}</span>
                            {tab.dirty && (
                                <span className="text-[#f59e0b]" aria-label={`${tab.label} has unsaved changes`}>●</span>
                            )}
                            <button
                                type="button"
                                aria-label={`Close tab ${tab.label}`}
                                className="ml-1 hover:text-[var(--app-fg)] text-[10px] leading-none"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    requestCloseTab(tab)
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        requestCloseTab(tab)
                                    }
                                }}
                            >
                                ✕
                            </button>
                        </div>
                    )
                })}
                {!props.mobileMode ? (
                    <button
                        type="button"
                        aria-label="New File"
                        className="px-2.5 py-1.5 text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors text-sm font-light"
                        onClick={() => props.onNewFile()}
                        title="New File"
                    >
                        +
                    </button>
                ) : null}
                <span className="flex-1" />
                {activeTab?.type === 'file' && activeTab.path && (
                    <div className="flex items-center gap-2 px-3 text-[10px] text-[var(--app-hint)] border-l border-[var(--app-border)]">
                        {activeTab.dirty && (
                            <button
                                type="button"
                                aria-label={`Save ${activeTab.label}`}
                                className="rounded border border-[var(--app-border)] px-2 py-0.5 text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                disabled={savingTabId === activeTab.id}
                                onClick={() => { void saveActiveFile() }}
                            >
                                {savingTabId === activeTab.id ? 'Saving...' : 'Save'}
                            </button>
                        )}
                        {saveError && <span className="text-red-500">{saveError}</span>}
                        {getFileExtensionLabel(activeTab.path)}
                    </div>
                )}
            </div>

            <div data-testid="editor-tabs-content" className="min-h-0 flex-1 overflow-hidden">
                {activeTab?.path && props.machineId && (() => {
                    const previewType = getFilePreviewType(activeTab.path!)
                    const viewMode = activeTab.viewMode ?? (previewType === 'markdown' ? 'source' : undefined)

                    return (
                        <div className="h-full min-h-0 flex flex-col overflow-hidden">
                            {/* Pill toggle for markdown files */}
                            {previewType === 'markdown' && (
                                <div className="flex items-center justify-end shrink-0 border-b border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1">
                                    <div className="inline-flex rounded border border-[var(--app-border)] overflow-hidden text-[11px]">
                                        <button
                                            type="button"
                                            className={`px-2.5 py-0.5 transition-colors ${viewMode !== 'preview' ? 'bg-[#6366f1] text-white' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'}`}
                                            onClick={() => props.setTabViewMode?.(activeTab.id, 'source')}
                                        >
                                            Source
                                        </button>
                                        <button
                                            type="button"
                                            className={`px-2.5 py-0.5 border-l border-[var(--app-border)] transition-colors ${viewMode === 'preview' ? 'bg-[#6366f1] text-white' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'}`}
                                            onClick={() => props.setTabViewMode?.(activeTab.id, 'preview')}
                                        >
                                            Preview
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div className="min-h-0 flex-1 overflow-hidden">
                                <FileTabContent
                                    api={props.api}
                                    machineId={props.machineId}
                                    tabId={activeTab.id}
                                    isDirty={activeTab.dirty === true}
                                    filePath={activeTab.path}
                                    viewMode={viewMode}
                                    previewType={previewType}
                                    onContentLoaded={handleContentLoaded}
                                    onContentChanged={handleContentChanged}
                                    onAddSelectionToChat={props.onAddSelectionToChat}
                                />
                            </div>
                        </div>
                    )
                })()}
                {activeTab?.path && !props.machineId && (
                    <div className="flex items-center justify-center h-full text-xs text-[var(--app-hint)]">
                        Select a machine to read files
                    </div>
                )}
                {!activeTab && (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--app-hint)] gap-2">
                        <div className="text-4xl opacity-30">📂</div>
                        <div className="text-sm">Open a file from the explorer</div>
                        <div className="text-xs">
                            or press <kbd className="px-1.5 py-0.5 rounded bg-[var(--app-subtle-bg)] border border-[var(--app-border)]">+</kbd> to create a file
                        </div>
                    </div>
                )}
            </div>

            <AppDialog
                open={pendingCloseTab !== null}
                onOpenChange={(open) => {
                    if (open || (pendingCloseTab && savingTabId === pendingCloseTab.id)) return
                    setPendingCloseTab(null)
                    setPendingCloseError(null)
                }}
            >
                {pendingCloseTab && (
                    <AppDialogContent presentation="alert" className="max-w-md">
                        <AppDialogHeader
                            title="Close unsaved tab?"
                            subtitle={`${pendingCloseTab.label} has unsaved changes.`}
                        />
                        {pendingCloseError ? (
                            <AppDialogBody className="px-4 pt-3 text-xs text-red-500">
                                {pendingCloseError}
                            </AppDialogBody>
                        ) : null}
                        <AppDialogFooter className="mx-auto w-full max-w-md flex-col">
                                <button
                                    type="button"
                                    className="rounded bg-[#6366f1] px-3 py-2 text-sm text-white disabled:opacity-50"
                                    disabled={savingTabId === pendingCloseTab.id}
                                    onClick={() => { void savePendingClose() }}
                                >
                                    {savingTabId === pendingCloseTab.id ? 'Saving...' : 'Save then close'}
                                </button>
                                <button
                                    type="button"
                                    className="rounded border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] disabled:opacity-50"
                                    disabled={savingTabId === pendingCloseTab.id}
                                    onClick={discardPendingClose}
                                >
                                    Discard changes
                                </button>
                                <button
                                    type="button"
                                    className="rounded px-3 py-2 text-sm text-[var(--app-hint)] disabled:opacity-50"
                                    disabled={savingTabId === pendingCloseTab.id}
                                    onClick={() => {
                                        setPendingCloseTab(null)
                                        setPendingCloseError(null)
                                    }}
                                >
                                    Cancel
                                </button>
                        </AppDialogFooter>
                    </AppDialogContent>
                )}
            </AppDialog>
        </div>
    )
}
