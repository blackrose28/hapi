import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HappyComposer } from './HappyComposer'

const assistant = vi.hoisted(() => ({
    state: {
        composer: {
            text: '',
            attachments: [] as Array<{ status: { type: string } }>
        },
        thread: {
            isRunning: false,
            isDisabled: false
        }
    },
    send: vi.fn(),
    cancelRun: vi.fn(),
    setText: vi.fn(),
    addAttachment: vi.fn()
}))

const platform = vi.hoisted(() => ({
    isTouch: false,
    hasCoarsePointer: false
}))

const suggestionState = vi.hoisted(() => ({
    suggestions: [] as Array<{ key: string; text: string; label: string }>,
    selectedIndex: -1
}))

vi.mock('@assistant-ui/react', async () => {
    const React = await vi.importActual<typeof import('react')>('react')

    return {
        useAssistantApi: () => ({
            composer: () => ({
                send: assistant.send,
                setText: assistant.setText,
                addAttachment: assistant.addAttachment
            }),
            thread: () => ({
                cancelRun: assistant.cancelRun
            })
        }),
        useAssistantState: (selector: (state: typeof assistant.state) => unknown) => selector(assistant.state),
        ComposerPrimitive: {
            Root: ({ children, onSubmit, className }: React.ComponentProps<'form'>) => (
                <form className={className} onSubmit={onSubmit}>{children}</form>
            ),
            Input: React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'> & {
                maxRows?: number
                submitOnEnter?: boolean
                cancelOnEscape?: boolean
            }>((props, ref) => {
                const {
                    maxRows: _maxRows,
                    submitOnEnter: _submitOnEnter,
                    cancelOnEscape: _cancelOnEscape,
                    onChange,
                    ...textareaProps
                } = props
                return (
                    <textarea
                        {...textareaProps}
                        ref={ref}
                        value={assistant.state.composer.text}
                        onChange={(event) => {
                            assistant.state.composer.text = event.target.value
                            assistant.setText(event.target.value)
                            onChange?.(event)
                        }}
                    />
                )
            }),
            AddAttachment: ({ children, ...props }: React.ComponentProps<'button'>) => (
                <button type="button" {...props}>{children}</button>
            ),
            Attachments: () => null
        }
    }
})

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        isTouch: platform.isTouch,
        haptic: {
            impact: vi.fn(),
            notification: vi.fn()
        }
    })
}))

vi.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => platform.hasCoarsePointer
}))

vi.mock('@/hooks/usePWAInstall', () => ({
    usePWAInstall: () => ({ isStandalone: false, isIOS: false })
}))

vi.mock('@/hooks/useActiveWord', () => ({
    useActiveWord: () => null
}))

vi.mock('@/hooks/useActiveSuggestions', () => ({
    useActiveSuggestions: () => [
        suggestionState.suggestions,
        suggestionState.selectedIndex,
        vi.fn(),
        vi.fn(),
        vi.fn()
    ]
}))

vi.mock('@/hooks/useComposerDraft', () => ({
    useComposerDraft: vi.fn()
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}))

describe('HappyComposer compact Agent mode', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        assistant.state.composer.text = ''
        assistant.state.composer.attachments = []
        assistant.state.thread.isRunning = false
        assistant.state.thread.isDisabled = false
        platform.isTouch = false
        platform.hasCoarsePointer = false
        suggestionState.suggestions = []
        suggestionState.selectedIndex = -1
        Element.prototype.scrollIntoView = vi.fn()
        window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
            callback(0)
            return 1
        })
        window.cancelAnimationFrame = vi.fn()
    })

    afterEach(() => {
        cleanup()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('keeps drafting enabled and blocks desktop Enter while Stop is the only running action', () => {
        assistant.state.thread.isRunning = true
        assistant.state.thread.isDisabled = true
        const view = render(<HappyComposer compactComposerMode sendDisabled />)
        const input = screen.getByRole('textbox')

        expect(input).toBeEnabled()
        expect(screen.getByRole('button', { name: 'composer.stop' })).toBeEnabled()
        expect(screen.queryByRole('button', { name: 'composer.send' })).not.toBeInTheDocument()

        fireEvent.change(input, { target: { value: 'draft while running' } })
        const enterEvent = createEvent.keyDown(input, { key: 'Enter' })
        fireEvent(input, enterEvent)

        expect(enterEvent.defaultPrevented).toBe(false)
        expect(assistant.send).not.toHaveBeenCalled()

        const submitEvent = createEvent.submit(input.closest('form')!)
        fireEvent(input.closest('form')!, submitEvent)
        expect(submitEvent.defaultPrevented).toBe(true)
        expect(assistant.send).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'composer.stop' }))
        expect(assistant.cancelRun).toHaveBeenCalledTimes(1)

        assistant.state.thread.isRunning = false
        assistant.state.thread.isDisabled = false
        view.rerender(<HappyComposer compactComposerMode sendDisabled />)

        expect(screen.getByRole('button', { name: 'composer.send' })).toBeDisabled()
        expect(assistant.send).not.toHaveBeenCalled()

        view.rerender(<HappyComposer compactComposerMode />)

        const send = screen.getByRole('button', { name: 'composer.send' })
        expect(send).toBeEnabled()
        fireEvent.click(send)
        expect(assistant.send).toHaveBeenCalledTimes(1)
    })

    it('keeps the same stop-only drafting behavior on touch devices with coarse pointers', () => {
        platform.isTouch = true
        platform.hasCoarsePointer = true
        assistant.state.thread.isRunning = true
        assistant.state.thread.isDisabled = true

        render(<HappyComposer compactComposerMode sendDisabled />)
        const input = screen.getByRole('textbox')

        expect(input).toBeEnabled()
        expect(screen.getByRole('button', { name: 'composer.stop' })).toBeEnabled()
        expect(screen.queryByRole('button', { name: 'composer.send' })).not.toBeInTheDocument()

        fireEvent.change(input, { target: { value: 'mobile draft' } })
        const enterEvent = createEvent.keyDown(input, { key: 'Enter' })
        fireEvent(input, enterEvent)

        expect(enterEvent.defaultPrevented).toBe(false)
        expect(assistant.send).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'composer.stop' }))
        expect(assistant.cancelRun).toHaveBeenCalledTimes(1)
    })

    it('selects an active suggestion on Enter while running without sending', () => {
        assistant.state.composer.text = '/he'
        assistant.state.thread.isRunning = true
        suggestionState.suggestions = [{ key: 'help', text: '/help', label: 'Help' }]
        suggestionState.selectedIndex = 0

        render(<HappyComposer compactComposerMode />)
        const input = screen.getByRole('textbox')
        const enterEvent = createEvent.keyDown(input, { key: 'Enter' })
        fireEvent(input, enterEvent)

        expect(enterEvent.defaultPrevented).toBe(true)
        expect(assistant.setText).toHaveBeenCalledWith('/help ')
        expect(assistant.send).not.toHaveBeenCalled()
    })

    it('keeps send latched indefinitely after acceptance while SSE is slow or missing', () => {
        vi.useFakeTimers()
        assistant.state.composer.text = 'first request'
        const view = render(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 0, state: 'idle' }}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'composer.send' }))
        expect(assistant.send).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: 'composer.send' })).toBeDisabled()

        view.rerender(
            <HappyComposer
                compactComposerMode
                sendDisabled
                compactSendStatus={{ attemptId: 1, state: 'pending' }}
            />
        )
        expect(screen.getByRole('button', { name: 'composer.send' })).toBeDisabled()

        view.rerender(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 1, state: 'accepted' }}
            />
        )
        expect(screen.getByRole('button', { name: 'composer.send' })).toBeDisabled()

        act(() => vi.advanceTimersByTime(60_000))
        expect(screen.getByRole('button', { name: 'composer.send' })).toBeDisabled()
    })

    it('releases the pre-run latch on an explicit send error', () => {
        assistant.state.composer.text = 'retryable request'
        const view = render(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 0, state: 'idle' }}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'composer.send' }))
        view.rerender(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 1, state: 'error' }}
            />
        )

        expect(screen.getByRole('button', { name: 'composer.send' })).toBeEnabled()
    })

    it('releases the accepted latch only after an observed running-to-done lifecycle', () => {
        assistant.state.composer.text = 'tracked request'
        const view = render(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 0, state: 'idle' }}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'composer.send' }))
        view.rerender(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 1, state: 'accepted' }}
            />
        )

        assistant.state.thread.isRunning = true
        view.rerender(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 1, state: 'accepted' }}
            />
        )
        expect(screen.getByRole('button', { name: 'composer.stop' })).toBeEnabled()

        assistant.state.thread.isRunning = false
        view.rerender(
            <HappyComposer
                compactComposerMode
                compactSendStatus={{ attemptId: 1, state: 'accepted' }}
            />
        )
        expect(screen.getByRole('button', { name: 'composer.send' })).toBeEnabled()
    })

    it('keeps the legacy composer and Terminal action outside Agent compact composer mode', () => {
        const onTerminal = vi.fn()

        render(<HappyComposer compactComposerMode={false} onTerminal={onTerminal} />)

        fireEvent.click(screen.getByRole('button', { name: 'composer.terminal' }))
        expect(onTerminal).toHaveBeenCalledTimes(1)
        expect(document.querySelector('.compact-composer')).not.toBeInTheDocument()
    })

    it('switches a compact local session to remote and preserves pending/error behavior', async () => {
        let rejectSwitch: ((reason?: unknown) => void) | undefined
        const onSwitchToRemote = vi.fn(() => new Promise<void>((_resolve, reject) => {
            rejectSwitch = reject
        }))

        render(
            <HappyComposer
                compactComposerMode
                controlledByUser
                onSwitchToRemote={onSwitchToRemote}
            />
        )

        const switchButton = screen.getByRole('button', { name: 'composer.switchRemote' })
        expect(switchButton).toHaveClass('compact-runtime-controls__switch')
        expect(document.querySelector('.compact-composer')).toBeInTheDocument()
        fireEvent.click(switchButton)

        expect(onSwitchToRemote).toHaveBeenCalledTimes(1)
        expect(switchButton).toBeDisabled()

        await act(async () => {
            rejectSwitch?.(new Error('switch failed'))
            await Promise.resolve()
        })

        await waitFor(() => expect(switchButton).toBeEnabled())
    })

    it('prevents switching to remote while a runtime change is pending', async () => {
        let rejectRuntime: ((reason?: unknown) => void) | undefined
        const onSwitchToRemote = vi.fn()
        const onCompactRuntimeChange = vi.fn(() => new Promise<void>((_resolve, reject) => {
            rejectRuntime = reject
        }))

        render(
            <HappyComposer
                compactComposerMode
                controlledByUser
                agentFlavor="claude"
                model={null}
                availableModelOptions={[
                    { value: null, label: 'Default' },
                    { value: 'model-a', label: 'Model A' }
                ]}
                onModelChange={vi.fn()}
                onCompactRuntimeChange={onCompactRuntimeChange}
                onSwitchToRemote={onSwitchToRemote}
            />
        )

        const model = screen.getByLabelText('misc.model')
        const modelA = screen.getByRole('option', { name: 'Model A' }) as HTMLOptionElement
        const switchButton = screen.getByRole('button', { name: 'composer.switchRemote' })
        fireEvent.change(model, { target: { value: modelA.value } })

        expect(switchButton).toBeDisabled()
        fireEvent.click(switchButton)
        expect(onSwitchToRemote).not.toHaveBeenCalled()

        await act(async () => {
            rejectRuntime?.(new Error('runtime failed'))
            await Promise.resolve()
        })
        await waitFor(() => expect(switchButton).toBeEnabled())
    })

    it('blocks runtime changes synchronously while switching to remote', async () => {
        let rejectSwitch: ((reason?: unknown) => void) | undefined
        const onSwitchToRemote = vi.fn(() => new Promise<void>((_resolve, reject) => {
            rejectSwitch = reject
        }))
        const onCompactRuntimeChange = vi.fn(() => Promise.resolve())

        render(
            <HappyComposer
                compactComposerMode
                controlledByUser
                agentFlavor="claude"
                model={null}
                availableModelOptions={[
                    { value: null, label: 'Default' },
                    { value: 'model-a', label: 'Model A' }
                ]}
                onModelChange={vi.fn()}
                onCompactRuntimeChange={onCompactRuntimeChange}
                onSwitchToRemote={onSwitchToRemote}
            />
        )

        const model = screen.getByLabelText('misc.model')
        const modelA = screen.getByRole('option', { name: 'Model A' }) as HTMLOptionElement
        fireEvent.click(screen.getByRole('button', { name: 'composer.switchRemote' }))

        expect(model).toBeDisabled()
        fireEvent.change(model, { target: { value: modelA.value } })
        expect(onCompactRuntimeChange).not.toHaveBeenCalled()

        await act(async () => {
            rejectSwitch?.(new Error('switch failed'))
            await Promise.resolve()
        })
        await waitFor(() => expect(model).toBeEnabled())
    })

    it('updates adaptive radius for explicit newlines, wrapping, resize, and observer cleanup', async () => {
        let resizeCallback: ResizeObserverCallback | undefined
        const disconnect = vi.fn()
        const observe = vi.fn()
        vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
            constructor(callback: ResizeObserverCallback) {
                resizeCallback = callback
            }
            observe = observe
            unobserve = vi.fn()
            disconnect = disconnect
        })

        assistant.state.composer.text = 'one line that may wrap'
        const view = render(<HappyComposer compactComposerMode />)
        const input = screen.getByRole('textbox')
        const composer = document.querySelector('.compact-composer')

        expect(observe).toHaveBeenCalledWith(input)
        expect(composer).toHaveAttribute('data-multiline', 'false')

        input.style.lineHeight = '20px'
        input.style.paddingTop = '2px'
        input.style.paddingBottom = '2px'
        Object.defineProperty(input, 'clientHeight', { configurable: true, value: 48 })
        Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 48 })
        act(() => resizeCallback?.([], {} as ResizeObserver))
        expect(composer).toHaveAttribute('data-multiline', 'true')

        Object.defineProperty(input, 'clientHeight', { configurable: true, value: 24 })
        Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 24 })
        act(() => resizeCallback?.([], {} as ResizeObserver))
        expect(composer).toHaveAttribute('data-multiline', 'false')

        assistant.state.composer.text = 'first\nsecond'
        view.rerender(<HappyComposer compactComposerMode />)
        await waitFor(() => expect(composer).toHaveAttribute('data-multiline', 'true'))

        view.unmount()
        expect(disconnect).toHaveBeenCalledTimes(1)
    })

    it('marks the compact composer as expanded while attachments are present', () => {
        assistant.state.composer.attachments = [{ status: { type: 'complete' } }]

        const view = render(<HappyComposer compactComposerMode />)
        const composer = document.querySelector('.compact-composer')

        expect(composer).toHaveAttribute('data-has-attachments', 'true')

        assistant.state.composer.attachments = []
        view.rerender(<HappyComposer compactComposerMode />)

        expect(composer).toHaveAttribute('data-has-attachments', 'false')
    })
})
