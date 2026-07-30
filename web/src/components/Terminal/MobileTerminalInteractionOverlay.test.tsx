import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    MobileTerminalInteractionOverlay,
    type MobileTerminalOverlayProps,
} from './MobileTerminalInteractionOverlay'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => ({
            'terminal.interaction.choice': 'Terminal action',
            'terminal.interaction.input': 'Input',
            'terminal.interaction.enter': 'Enter',
            'terminal.interaction.select': 'Select',
            'terminal.interaction.selectionToolbar': 'Selection actions',
            'terminal.interaction.selectionStart': 'Selection start',
            'terminal.interaction.selectionEnd': 'Selection end',
            'terminal.interaction.copy': 'Copy',
            'terminal.interaction.selectAll': 'Select all',
            'terminal.interaction.cancel': 'Cancel',
            'terminal.interaction.copied': 'Copied',
            'terminal.interaction.copyFailed': 'Could not copy',
        }[key] ?? key),
    }),
}))

const baseProps: MobileTerminalOverlayProps = {
    mode: 'idle',
    choiceAnchor: null,
    startHandle: null,
    endHandle: null,
    toolbarAnchor: null,
    feedback: null,
    onInput: vi.fn(),
    onEnter: vi.fn(),
    onSelect: vi.fn(),
    onCopy: vi.fn(),
    onSelectAll: vi.fn(),
    onCancel: vi.fn(),
    onSelectionPointerDown: vi.fn(),
    onHandlePointerDown: vi.fn(),
}

const rect = (width: number, height: number): DOMRect => ({
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => undefined,
})

let rootSize = rect(320, 480)
let toolbarSize = rect(160, 52)

beforeEach(() => {
    rootSize = rect(320, 480)
    toolbarSize = rect(160, 52)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        function getBoundingClientRect(this: HTMLElement) {
            return this.dataset.testid === 'mobile-terminal-overlay-root'
                ? rootSize
                : toolbarSize
        },
    )
})

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
})

describe('MobileTerminalInteractionOverlay', () => {
    it('renders the choice actions at the supplied anchor', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="choice"
                choiceAnchor={{ x: 120, y: 80 }}
            />,
        )

        const toolbar = screen.getByRole('toolbar', { name: 'Terminal action' })
        expect(toolbar).toHaveStyle({ left: '40px', top: '20px' })
        expect(toolbar).toHaveAttribute('data-placement', 'above')
        expect(toolbar).toHaveClass('rounded-xl', 'p-0.5')

        const inputAction = screen.getByRole('button', { name: 'Input' })
        const enterAction = screen.getByRole('button', { name: 'Enter' })
        const selectAction = screen.getByRole('button', { name: 'Select' })
        expect(
            screen.getAllByRole('button').map((action) => action.textContent),
        ).toEqual(['Input', 'Enter', 'Select'])
        for (const action of [inputAction, enterAction, selectAction]) {
            expect(action).toHaveClass(
                'min-h-[44px]',
                'min-w-[44px]',
                'px-3',
                'text-[13px]',
            )
        }

        fireEvent.click(inputAction)
        fireEvent.click(enterAction)
        fireEvent.click(selectAction)
        expect(baseProps.onInput).toHaveBeenCalledOnce()
        expect(baseProps.onEnter).toHaveBeenCalledOnce()
        expect(baseProps.onSelect).toHaveBeenCalledOnce()
    })

    it('ignores a delayed compatibility click until a fresh pointer gesture arms the action', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="choice"
                choiceAnchor={{ x: 120, y: 80 }}
            />,
        )

        const inputAction = screen.getByRole('button', { name: 'Input' })
        fireEvent(
            inputAction,
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                detail: 1,
            }),
        )
        expect(baseProps.onInput).not.toHaveBeenCalled()

        fireEvent.pointerDown(inputAction, {
            pointerId: 2,
            pointerType: 'touch',
        })
        fireEvent(
            inputAction,
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                detail: 1,
            }),
        )
        expect(baseProps.onInput).toHaveBeenCalledOnce()

        const selectAction = screen.getByRole('button', { name: 'Select' })
        fireEvent(
            selectAction,
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                detail: 1,
            }),
        )
        expect(baseProps.onSelect).not.toHaveBeenCalled()

        fireEvent.pointerDown(selectAction, {
            pointerId: 3,
            pointerType: 'touch',
        })
        fireEvent(
            selectAction,
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                detail: 1,
            }),
        )
        expect(baseProps.onSelect).toHaveBeenCalledOnce()
    })

    it('preserves a valid centered selection anchor', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="select"
                toolbarAnchor={{ x: 180, y: 200 }}
            />,
        )

        const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
        expect(toolbar).toHaveStyle({
            left: '100px',
            top: '140px',
        })
        expect(toolbar).toHaveAttribute('data-placement', 'above')
    })

    it('renders handles and routes all selection actions in select mode', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="select"
                startHandle={{ x: 40, y: 100 }}
                endHandle={{ x: 180, y: 120 }}
                toolbarAnchor={{ x: 110, y: 70 }}
            />,
        )

        const startHandle = screen.getByRole('button', { name: 'Selection start' })
        const endHandle = screen.getByRole('button', { name: 'Selection end' })
        const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
        expect(toolbar).toHaveClass('rounded-xl', 'p-0.5', 'shadow-lg')
        expect(startHandle).toBeVisible()
        expect(endHandle).toBeVisible()
        expect(startHandle).toHaveClass('h-[44px]', 'w-[44px]')
        expect(endHandle).toHaveClass('h-[44px]', 'w-[44px]')

        fireEvent.pointerDown(startHandle)
        fireEvent.pointerDown(endHandle)
        const copyAction = screen.getByRole('button', { name: 'Copy' })
        const selectAllAction = screen.getByRole('button', { name: 'Select all' })
        const cancelAction = screen.getByRole('button', { name: 'Cancel' })
        for (const action of [copyAction, selectAllAction, cancelAction]) {
            expect(action).toHaveClass(
                'min-h-[44px]',
                'min-w-[44px]',
                'px-3',
                'text-[13px]',
            )
        }

        fireEvent.click(copyAction)
        fireEvent.click(selectAllAction)
        fireEvent.click(cancelAction)

        expect(baseProps.onHandlePointerDown).toHaveBeenNthCalledWith(
            1,
            'start',
            expect.anything(),
        )
        expect(baseProps.onHandlePointerDown).toHaveBeenNthCalledWith(
            2,
            'end',
            expect.anything(),
        )
        expect(baseProps.onCopy).toHaveBeenCalledOnce()
        expect(baseProps.onSelectAll).toHaveBeenCalledOnce()
        expect(baseProps.onCancel).toHaveBeenCalledOnce()
        expect(toolbar).toBeVisible()
    })

    it.each([
        ['left', 20, 8],
        ['right', 300, 152],
    ])('clamps a %s-edge selection toolbar within the overlay', (_, anchorX, left) => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="select"
                toolbarAnchor={{ x: anchorX, y: 200 }}
            />,
        )

        const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
        expect(toolbar).toHaveStyle({ left: `${left}px`, top: '140px' })
        expect(toolbar).toHaveAttribute('data-placement', 'above')
    })

    it('flips a near-top selection toolbar below its anchor', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="select"
                startHandle={{ x: 140, y: 20 }}
                endHandle={{ x: 180, y: 20 }}
                toolbarAnchor={{ x: 160, y: 20 }}
            />,
        )

        const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
        expect(toolbar).toHaveStyle({ left: '80px', top: '28px' })
        expect(toolbar).toHaveAttribute('data-placement', 'below')
    })

    it('keeps a near-bottom selection toolbar above its anchor', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="select"
                toolbarAnchor={{ x: 160, y: 460 }}
            />,
        )

        const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
        expect(toolbar).toHaveStyle({ left: '80px', top: '400px' })
        expect(toolbar).toHaveAttribute('data-placement', 'above')
    })

    it('routes selection pointer-down without letting toolbar presses bubble', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="select"
                toolbarAnchor={{ x: 110, y: 70 }}
            />,
        )

        fireEvent.pointerDown(screen.getByTestId('terminal-selection-layer'))
        expect(baseProps.onSelectionPointerDown).toHaveBeenCalledOnce()

        vi.mocked(baseProps.onSelectionPointerDown).mockClear()
        fireEvent.pointerDown(screen.getByRole('toolbar', { name: 'Selection actions' }))
        expect(baseProps.onSelectionPointerDown).not.toHaveBeenCalled()
    })

    it('announces copy failure without removing selection controls', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="select"
                feedback="copy-error"
                toolbarAnchor={{ x: 160, y: 200 }}
            />,
        )

        expect(screen.getByRole('status')).toHaveTextContent('Could not copy')
        expect(screen.getByRole('status')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
    })

    it('shows copied feedback after selection has returned to idle', () => {
        render(
            <MobileTerminalInteractionOverlay
                {...baseProps}
                mode="idle"
                feedback="copied"
            />,
        )

        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('Copied')
        expect(status).toHaveAttribute('aria-live', 'polite')
        expect(status).toBeVisible()
        expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    })
})
