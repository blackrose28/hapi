import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
    AssistantRuntimeProvider,
    ComposerPrimitive,
    useAssistantApi,
    useAssistantState
} from '@assistant-ui/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/types/api'
import { useHappyRuntime } from './assistant-runtime'

function SendProbe() {
    const api = useAssistantApi()
    return (
        <button type="button" onClick={() => api.composer().send()}>
            Internal send
        </button>
    )
}

function RunningProbe() {
    const isRunning = useAssistantState(({ thread }) => thread.isRunning)
    return <output aria-label="Runtime state">{isRunning ? 'running' : 'idle'}</output>
}

function RuntimeComposer(props: {
    thinking: boolean
    isSending: boolean
    isAgentRunning?: boolean
    onSendMessage: (text: string) => void
}) {
    const runtime = useHappyRuntime({
        session: {
            active: true,
            thinking: props.thinking
        } as Session,
        blocks: [],
        isSending: props.isSending,
        onSendMessage: props.onSendMessage,
        onAbort: async () => undefined,
        allowDraftWhileRunning: true,
        isAgentRunning: props.isAgentRunning
    } as Parameters<typeof useHappyRuntime>[0])

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <ComposerPrimitive.Root>
                <ComposerPrimitive.Input aria-label="Runtime composer" />
                <SendProbe />
            </ComposerPrimitive.Root>
            <RunningProbe />
        </AssistantRuntimeProvider>
    )
}

afterEach(() => {
    cleanup()
})

describe('useHappyRuntime compact draftability', () => {
    it('keeps the real assistant-ui input editable while running and blocks internal send', () => {
        const onSendMessage = vi.fn()
        render(
            <RuntimeComposer
                thinking
                isSending
                onSendMessage={onSendMessage}
            />
        )

        const input = screen.getByRole('textbox', { name: 'Runtime composer' })
        expect(input).toBeEnabled()
        expect(screen.getByLabelText('Runtime state')).toHaveTextContent('running')

        fireEvent.change(input, { target: { value: 'draft during run' } })
        fireEvent.click(screen.getByRole('button', { name: 'Internal send' }))

        expect(onSendMessage).not.toHaveBeenCalled()
        expect(input).toHaveValue('draft during run')
    })

    it('uses an inferred provider run when the session thinking flag lags behind', () => {
        const onSendMessage = vi.fn()
        render(
            <RuntimeComposer
                thinking={false}
                isSending={false}
                isAgentRunning
                onSendMessage={onSendMessage}
            />
        )

        const input = screen.getByRole('textbox', { name: 'Runtime composer' })
        expect(input).toBeEnabled()
        expect(screen.getByLabelText('Runtime state')).toHaveTextContent('running')

        fireEvent.change(input, { target: { value: 'draft during inferred run' } })
        fireEvent.click(screen.getByRole('button', { name: 'Internal send' }))

        expect(onSendMessage).not.toHaveBeenCalled()
        expect(input).toHaveValue('draft during inferred run')
    })
})
