import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { LaunchEffortSelector } from './LaunchEffortSelector'

describe('LaunchEffortSelector', () => {
    it('renders nothing for agents without an effort picker', () => {
        const { container } = render(
            <LaunchEffortSelector
                agent="codex"
                effort="auto"
                isDisabled={false}
                onEffortChange={vi.fn()}
            />
        )
        expect(container).toBeEmptyDOMElement()
    })

    it('renders Claude effort options and forwards the selection', () => {
        const onChange = vi.fn()
        const { container } = render(
            <LaunchEffortSelector
                agent="claude"
                effort="auto"
                isDisabled={false}
                onEffortChange={onChange}
            />
        )
        const select = container.querySelector('select') as HTMLSelectElement

        expect(Array.from(select.options).map((option) => option.value)).toEqual([
            'auto', 'medium', 'high', 'max'
        ])
        fireEvent.change(select, { target: { value: 'max' } })
        expect(onChange).toHaveBeenCalledWith('max')
    })

    it('renders Grok low/medium/high effort and forwards the selection', () => {
        const onChange = vi.fn()
        const { container } = render(
            <LaunchEffortSelector
                agent="grok"
                effort="auto"
                isDisabled={false}
                onEffortChange={onChange}
            />
        )
        const select = container.querySelector('select') as HTMLSelectElement

        expect(Array.from(select.options).map((option) => option.value)).toEqual([
            'auto', 'low', 'medium', 'high'
        ])
        fireEvent.change(select, { target: { value: 'low' } })
        expect(onChange).toHaveBeenCalledWith('low')
    })

    it('prefers dynamically discovered Grok effort options when provided', () => {
        const { container } = render(
            <LaunchEffortSelector
                agent="grok"
                effort="auto"
                isDisabled={false}
                onEffortChange={vi.fn()}
                grokOptions={[{ value: 'auto', label: 'Default' }, { value: 'turbo', label: 'Turbo' }]}
            />
        )
        const select = container.querySelector('select') as HTMLSelectElement

        expect(Array.from(select.options).map((option) => option.value)).toEqual(['auto', 'turbo'])
    })
})
