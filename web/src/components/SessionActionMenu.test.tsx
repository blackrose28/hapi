import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionActionMenu } from './SessionActionMenu'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}))

afterEach(() => {
    cleanup()
})

describe('SessionActionMenu', () => {
    it('portals the floating menu outside transformed session modal layout', () => {
        const { container } = render(
            <div data-testid="session-modal">
                <SessionActionMenu
                    isOpen
                    onClose={vi.fn()}
                    sessionActive
                    onRename={vi.fn()}
                    onArchive={vi.fn()}
                    onDelete={vi.fn()}
                    anchorPoint={{ x: 400, y: 80 }}
                />
            </div>
        )

        const floatingSurface = screen.getByRole('menu').parentElement

        expect(floatingSurface?.parentElement).toBe(document.body)
        expect(container.contains(floatingSurface)).toBe(false)
        expect(floatingSurface).toHaveClass('fixed')
    })

    it('runs optional compact actions and closes the menu', () => {
        const onClose = vi.fn()
        const onOpenFiles = vi.fn()
        const onUnpin = vi.fn()

        render(
            <SessionActionMenu
                isOpen
                onClose={onClose}
                sessionActive
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                onOpenFiles={onOpenFiles}
                onUnpin={onUnpin}
                anchorPoint={{ x: 400, y: 80 }}
            />
        )

        fireEvent.click(screen.getByRole('menuitem', { name: 'session.title' }))
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(onOpenFiles).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByRole('menuitem', { name: 'dashboard.unpin' }))
        expect(onClose).toHaveBeenCalledTimes(2)
        expect(onUnpin).toHaveBeenCalledTimes(1)
    })

    it('hides the Files item and its separator together on desktop by default', () => {
        render(
            <SessionActionMenu
                isOpen
                onClose={vi.fn()}
                sessionActive
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                onOpenFiles={vi.fn()}
                anchorPoint={{ x: 400, y: 80 }}
            />
        )

        expect(screen.getByRole('menuitem', { name: 'session.title' })).toHaveClass('session-action-menu__mobile-only')
        expect(screen.getByRole('separator')).toHaveClass('session-action-menu__mobile-only')
    })

    it('keeps Files and its separator visible on desktop when requested', () => {
        render(
            <SessionActionMenu
                isOpen
                onClose={vi.fn()}
                sessionActive
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                onOpenFiles={vi.fn()}
                filesVisibleOnDesktop
                anchorPoint={{ x: 400, y: 80 }}
            />
        )

        expect(screen.getByRole('menuitem', { name: 'session.title' })).not.toHaveClass('session-action-menu__mobile-only')
        expect(screen.getByRole('separator')).not.toHaveClass('session-action-menu__mobile-only')
    })

    it('keeps the separator visible on desktop when Unpin is available', () => {
        render(
            <SessionActionMenu
                isOpen
                onClose={vi.fn()}
                sessionActive
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                onOpenFiles={vi.fn()}
                onUnpin={vi.fn()}
                anchorPoint={{ x: 400, y: 80 }}
            />
        )

        expect(screen.getByRole('menuitem', { name: 'session.title' })).toHaveClass('session-action-menu__mobile-only')
        expect(screen.getByRole('separator')).not.toHaveClass('session-action-menu__mobile-only')
    })
})
