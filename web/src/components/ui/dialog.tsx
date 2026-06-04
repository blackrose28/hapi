import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { CloseIcon } from '@/components/icons'
import { useTranslation } from '@/lib/use-translation'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    closeLabel?: string
    closeClassName?: string
    closeButtonClassName?: string
    showClose?: boolean
}

export const DialogContent = React.forwardRef<
    HTMLDivElement,
    DialogContentProps
>(({ className, closeLabel, closeClassName, closeButtonClassName, showClose = true, children, ...props }, ref) => {
    const { t } = useTranslation()
    const resolvedCloseLabel = closeLabel ?? t('button.close')
    return (
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
            <DialogPrimitive.Content
                ref={ref}
                className={cn(
                    'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-[var(--app-dialog-bg)] border border-[var(--app-border)] p-4 shadow-2xl outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
                    className
                )}
                {...props}
            >
                {children}
                {showClose ? (
                    <DialogPrimitive.Close
                        className={cn(
                            'absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                            closeClassName,
                            closeButtonClassName
                        )}
                        aria-label={resolvedCloseLabel}
                    >
                        <CloseIcon className="h-4 w-4" />
                        <span className="sr-only">{resolvedCloseLabel}</span>
                    </DialogPrimitive.Close>
                ) : null}
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    )
})
DialogContent.displayName = 'DialogContent'

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    // pr-12 reserves space for the absolutely-positioned close button (top-right)
    // so long/breaking titles don't wrap underneath the tap target.
    <div className={cn('flex flex-col space-y-1.5 pr-12 text-center sm:text-left', className)} {...props} />
)

export const DialogTitle = React.forwardRef<
    HTMLHeadingElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn('text-base font-semibold leading-none tracking-tight', className)}
        {...props}
    />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = React.forwardRef<
    HTMLParagraphElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn('text-sm text-[var(--app-hint)]', className)}
        {...props}
    />
))
DialogDescription.displayName = 'DialogDescription'
