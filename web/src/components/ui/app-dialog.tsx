import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { CloseIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from './dialog'

export const AppDialog = Dialog
export const AppDialogTrigger = DialogTrigger

export type AppDialogPresentation = 'alert' | 'sheet' | 'workspace'

type AppDialogContentProps = ComponentProps<typeof DialogContent> & {
    dismissible?: boolean
    presentation?: AppDialogPresentation
}

const presentationClasses: Record<AppDialogPresentation, string> = {
    alert: '',
    sheet: 'max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:max-h-[82dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[20px] max-sm:pb-[env(safe-area-inset-bottom)]',
    workspace: 'max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]',
}

export function AppDialogContent(props: AppDialogContentProps) {
    const {
        children,
        className,
        dismissible = true,
        presentation = 'alert',
        onEscapeKeyDown,
        onInteractOutside,
        onPointerDownOutside,
        showClose: _showClose,
        ...rest
    } = props
    return (
        <DialogContent
            showClose={false}
            data-app-dialog-content=""
            data-app-dialog-presentation={presentation}
            onEscapeKeyDown={(event) => {
                onEscapeKeyDown?.(event)
                if (!dismissible) event.preventDefault()
            }}
            onInteractOutside={(event) => {
                onInteractOutside?.(event)
                if (!dismissible) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
                onPointerDownOutside?.(event)
                if (!dismissible) event.preventDefault()
            }}
            className={cn(
                'flex max-h-[calc(100dvh-24px)] flex-col gap-0 overflow-hidden border-[var(--app-border)] bg-[var(--app-bg)] p-0 motion-reduce:animate-none motion-reduce:duration-0',
                presentationClasses[presentation],
                className
            )}
            {...rest}
        >
            {presentation === 'sheet' ? (
                <div
                    data-app-dialog-sheet-handle=""
                    aria-hidden="true"
                    className="grid h-5 shrink-0 place-items-center sm:hidden"
                >
                    <span className="h-1 w-9 rounded-full bg-[var(--app-border)]" />
                </div>
            ) : null}
            {children}
        </DialogContent>
    )
}

export function AppDialogHeader(props: {
    icon?: ReactNode
    title: ReactNode
    subtitle?: ReactNode
    meta?: ReactNode
    actions?: ReactNode
    closeLabel?: string
    closeDisabled?: boolean
    mobileNavigation?: 'close' | 'back'
    mobileBackLabel?: string
    onMobileBack?: () => void
    className?: string
}) {
    const mobileNavigation = props.mobileNavigation ?? 'close'

    return (
        <header
            data-app-dialog-header=""
            className={cn(
                'flex min-h-[50px] shrink-0 items-center gap-3 border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] pl-3 pr-1.5',
                props.className
            )}
        >
            {mobileNavigation === 'back' ? (
                <button
                    type="button"
                    aria-label={props.mobileBackLabel ?? 'Back'}
                    disabled={props.closeDisabled}
                    onClick={props.onMobileBack}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-button)] disabled:cursor-not-allowed disabled:opacity-50 sm:hidden"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-[18px] w-[18px]"
                        aria-hidden="true"
                    >
                        <path d="m15 18-6-6 6-6" />
                    </svg>
                </button>
            ) : null}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {props.icon ? <div className="shrink-0">{props.icon}</div> : null}
                <div className="min-w-0">
                    <DialogTitle className="truncate text-sm font-semibold text-[var(--app-fg)]">
                        {props.title}
                    </DialogTitle>
                    {props.subtitle ? (
                        <DialogDescription className="mt-0.5 truncate text-[11px] text-[var(--app-hint)]">
                            {props.subtitle}
                        </DialogDescription>
                    ) : (
                        <DialogDescription className="sr-only">
                            {typeof props.title === 'string' ? `${props.title} dialog` : 'Dialog'}
                        </DialogDescription>
                    )}
                </div>
            </div>
            {props.meta ? <div className="flex shrink-0 items-center gap-2">{props.meta}</div> : null}
            {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
            <AppDialogClose
                label={props.closeLabel}
                disabled={props.closeDisabled}
                className={mobileNavigation === 'back' ? 'max-sm:hidden' : undefined}
            />
        </header>
    )
}

export function AppDialogClose({
    label = 'Close',
    disabled = false,
    className,
}: {
    label?: string
    disabled?: boolean
    className?: string
}) {
    return (
        <DialogClose asChild>
            <button
                type="button"
                aria-label={label}
                disabled={disabled}
                className={cn(
                    'grid h-11 w-11 shrink-0 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-button)] disabled:cursor-not-allowed disabled:opacity-50',
                    className
                )}
            >
                <span className="grid h-[28px] w-[28px] place-items-center rounded-lg border border-[var(--app-border)] bg-transparent text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]">
                    <CloseIcon className="h-[13px] w-[13px]" />
                </span>
            </button>
        </DialogClose>
    )
}

export function AppDialogBody(props: HTMLAttributes<HTMLDivElement>) {
    return <div {...props} className={cn('min-h-0 flex-1', props.className)} />
}

export function AppDialogFooter(props: HTMLAttributes<HTMLDivElement>) {
    return (
        <footer
            data-app-dialog-footer=""
            {...props}
            className={cn(
                'flex shrink-0 items-center justify-end gap-2 border-t border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2.5',
                props.className
            )}
        />
    )
}
