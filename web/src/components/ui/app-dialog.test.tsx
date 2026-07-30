import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
} from './app-dialog'

describe('AppDialog', () => {
    afterEach(() => cleanup())

    it('renders shared header slots and one accessible close control', () => {
        render(
            <AppDialog open>
                <AppDialogContent data-testid="content" className="h-[85vh] max-w-3xl">
                    <AppDialogHeader
                        icon={<span data-testid="icon">T</span>}
                        title="Terminal"
                        subtitle="/repo"
                        meta={<span>connected</span>}
                        actions={<button type="button">Refresh</button>}
                    />
                    <AppDialogBody>Body</AppDialogBody>
                    <AppDialogFooter>Footer</AppDialogFooter>
                </AppDialogContent>
            </AppDialog>
        )

        expect(screen.getByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
        expect(screen.getByText('/repo')).toBeInTheDocument()
        expect(screen.getByText('connected')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
        expect(screen.getByTestId('content')).toHaveClass('h-[85vh]', 'max-w-3xl')
        expect(document.querySelector('[data-app-dialog-footer]')).toHaveTextContent('Footer')
    })

    it.each([
        ['sheet', ['max-sm:bottom-0', 'max-sm:top-auto', 'max-sm:max-h-[82dvh]', 'max-sm:rounded-b-none']],
        ['workspace', ['max-sm:inset-0', 'max-sm:h-[100dvh]', 'max-sm:max-h-none', 'max-sm:rounded-none']]
    ] as const)('applies the %s mobile presentation', (presentation, classes) => {
        render(
            <AppDialog open>
                <AppDialogContent
                    presentation={presentation}
                    data-testid={`${presentation}-content`}
                >
                    <AppDialogHeader title="Example" />
                </AppDialogContent>
            </AppDialog>
        )

        expect(screen.getByTestId(`${presentation}-content`)).toHaveClass(...classes)
        expect(screen.getByTestId(`${presentation}-content`))
            .toHaveAttribute('data-app-dialog-presentation', presentation)
    })

    it('keeps alert as the default presentation', () => {
        render(
            <AppDialog open>
                <AppDialogContent data-testid="alert-content">
                    <AppDialogHeader title="Alert" />
                </AppDialogContent>
            </AppDialog>
        )

        expect(screen.getByTestId('alert-content'))
            .toHaveAttribute('data-app-dialog-presentation', 'alert')
    })

    it('disables dialog motion when the user requests reduced motion', () => {
        render(
            <AppDialog open>
                <AppDialogContent data-testid="content">
                    <AppDialogHeader title="Accessible dialog" />
                </AppDialogContent>
            </AppDialog>
        )

        expect(screen.getByTestId('content'))
            .toHaveClass('motion-reduce:animate-none', 'motion-reduce:duration-0')
    })

    it('renders a mobile-only handle for sheets', () => {
        render(
            <AppDialog open>
                <AppDialogContent presentation="sheet">
                    <AppDialogHeader title="Tasks" />
                </AppDialogContent>
            </AppDialog>
        )

        expect(document.querySelector('[data-app-dialog-sheet-handle]')).toHaveClass('sm:hidden')
    })

    it('uses a slim outline visual inside a larger close hit area', () => {
        render(
            <AppDialog open>
                <AppDialogContent>
                    <AppDialogHeader title="Settings" />
                    <AppDialogBody>Body</AppDialogBody>
                </AppDialogContent>
            </AppDialog>
        )

        const close = screen.getByRole('button', { name: 'Close' })
        expect(close).toHaveClass('h-11', 'w-11')
        expect(close.firstElementChild).toHaveClass('h-[28px]', 'w-[28px]', 'border')
        expect(screen.getByText('Settings dialog')).toHaveClass('sr-only')
        expect(document.querySelector('[data-app-dialog-footer]')).not.toBeInTheDocument()
    })

    it('uses Back on mobile and Close on desktop for workspace navigation', () => {
        const onMobileBack = vi.fn()
        render(
            <AppDialog open>
                <AppDialogContent presentation="workspace">
                    <AppDialogHeader
                        title="Terminal"
                        mobileNavigation="back"
                        mobileBackLabel="Back to session"
                        onMobileBack={onMobileBack}
                    />
                </AppDialogContent>
            </AppDialog>
        )

        const back = screen.getByRole('button', { name: 'Back to session' })
        fireEvent.click(back)

        expect(onMobileBack).toHaveBeenCalledOnce()
        expect(back).toHaveClass('sm:hidden', 'h-11', 'w-11')
        expect(screen.getByRole('button', { name: 'Close' }))
            .toHaveClass('max-sm:hidden', 'h-11', 'w-11')
    })

    it('suppresses the native outline when focus falls back to the dialog frame', () => {
        render(
            <AppDialog open>
                <AppDialogContent data-testid="content">
                    <AppDialogHeader title="Terminal" />
                    <AppDialogBody>Body</AppDialogBody>
                </AppDialogContent>
            </AppDialog>
        )

        expect(screen.getByTestId('content')).toHaveClass('outline-none')
    })

    it('lets non-dismissible feature dialogs keep their existing Escape behavior', () => {
        function Harness() {
            const [open, setOpen] = useState(true)
            return (
                <AppDialog open={open} onOpenChange={setOpen}>
                    <AppDialogContent dismissible={false}>
                        <AppDialogHeader title="Destructive action" />
                        <AppDialogBody>Body</AppDialogBody>
                    </AppDialogContent>
                </AppDialog>
            )
        }

        render(<Harness />)
        fireEvent.keyDown(document, { key: 'Escape' })

        expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('can disable the shared close control while a feature action is pending', () => {
        render(
            <AppDialog open>
                <AppDialogContent>
                    <AppDialogHeader title="Saving" closeDisabled />
                </AppDialogContent>
            </AppDialog>
        )

        expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    })
})
