import { useEffect, useId, useState, type FC, type PropsWithChildren, type ReactNode } from 'react'
import { useMessage } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { defaultComponents, MARKDOWN_PLUGINS, MARKDOWN_REHYPE_PLUGINS } from '@/components/assistant-ui/markdown-text'

function ChevronIcon(props: { className?: string; open?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={cn(
                'transition-transform duration-200 motion-reduce:transition-none',
                props.open ? 'rotate-90' : '',
                props.className
            )}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function ShimmerDot() {
    return (
        <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse motion-reduce:animate-none"
        />
    )
}

/**
 * Renders individual reasoning message part content with markdown support.
 */
export const Reasoning: FC = () => {
    return (
        <MarkdownTextPrimitive
            remarkPlugins={MARKDOWN_PLUGINS}
            rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            components={defaultComponents}
            className={cn('aui-reasoning-content min-w-0 max-w-full break-words text-sm text-[var(--app-hint)]')}
        />
    )
}

type ReasoningDisclosureProps = {
    label: string
    ariaLabel: string
    isStreaming: boolean
    presentation?: 'standalone' | 'group-row'
    duration?: string
    durationAriaLabel?: string
    statusLabel?: string
    children: ReactNode
}

export function ReasoningDisclosure(props: ReasoningDisclosureProps) {
    const [isOpen, setIsOpen] = useState(false)
    const contentId = useId()
    const durationDescriptionId = useId()
    const groupRow = props.presentation === 'group-row'
    const describedBy = props.duration && props.durationAriaLabel
        ? durationDescriptionId
        : undefined

    useEffect(() => {
        if (props.isStreaming) {
            setIsOpen(true)
        }
    }, [props.isStreaming])

    return (
        <div
            data-reasoning-layout={groupRow ? 'group-row' : 'standalone'}
            className={cn(
                'aui-reasoning-group',
                groupRow ? 'w-full' : 'my-1'
            )}
        >
            <button
                type="button"
                data-running={groupRow ? (props.isStreaming ? 'true' : 'false') : undefined}
                aria-expanded={isOpen}
                aria-controls={contentId}
                aria-label={props.ariaLabel}
                aria-describedby={describedBy}
                onClick={() => setIsOpen((value) => !value)}
                className={cn(
                    'cursor-pointer select-none items-center gap-1.5 rounded-[11px] px-2 text-xs font-medium text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                    groupRow ? 'activity-row flex min-h-[37px] w-full text-left' : 'inline-flex min-h-8'
                )}
            >
                <ChevronIcon open={isOpen} />
                <span className={cn(groupRow && 'min-w-0 flex-1 truncate')}>{props.label}</span>
                {props.duration ? (
                    <>
                        <span
                            aria-hidden="true"
                            className="shrink-0 font-mono text-[10px] text-[var(--app-hint)]"
                        >
                            {props.duration}
                        </span>
                        {props.durationAriaLabel ? (
                            <span id={durationDescriptionId} className="sr-only">
                                {props.durationAriaLabel}
                            </span>
                        ) : null}
                    </>
                ) : null}
                {groupRow && props.statusLabel ? (
                    <span
                        role="status"
                        aria-label={props.statusLabel}
                        className={cn(
                            'shrink-0',
                            props.isStreaming ? 'text-[var(--app-hint)]' : 'text-emerald-600'
                        )}
                    >
                        {props.isStreaming ? <ShimmerDot /> : <span aria-hidden="true">✓</span>}
                        <span className="sr-only">{props.statusLabel}</span>
                    </span>
                ) : props.isStreaming ? <ShimmerDot /> : null}
            </button>

            <div
                id={contentId}
                hidden={!isOpen}
                data-reasoning-body
                className={cn(
                    'transition-opacity duration-200 motion-reduce:transition-none',
                    isOpen ? 'opacity-100' : 'opacity-0'
                )}
            >
                <div className={cn(groupRow ? 'px-6 pb-2 pt-1' : 'pl-4 pt-1')}>
                    {props.children}
                </div>
            </div>
        </div>
    )
}

/**
 * Wraps consecutive reasoning parts in a collapsible container.
 * Shows shimmer effect while reasoning is streaming.
 */
export const ReasoningGroup: FC<PropsWithChildren> = ({ children }) => {
    const { t } = useTranslation()

    // Check if reasoning is still streaming
    const message = useMessage()
    const isStreaming = message.status?.type === 'running'
        && message.content.length > 0
        && message.content[message.content.length - 1]?.type === 'reasoning'

    return (
        <ReasoningDisclosure
            label={t('tool.title.reasoning')}
            ariaLabel={isStreaming ? t('reasoning.streaming') : t('reasoning.toggle')}
            isStreaming={isStreaming}
        >
            {children}
        </ReasoningDisclosure>
    )
}
