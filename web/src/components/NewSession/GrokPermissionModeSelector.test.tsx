import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { GrokPermissionModeSelector } from './GrokPermissionModeSelector'

describe('GrokPermissionModeSelector', () => {
    it('renders nothing for non-Grok agents', () => {
        const { container } = render(<I18nProvider>
            <GrokPermissionModeSelector
                agent="claude"
                value="default"
                isDisabled={false}
                onChange={vi.fn()}
            />
        </I18nProvider>)

        expect(container).toBeEmptyDOMElement()
    })

    it('offers default/plan/bypassPermissions for Grok (auto not supported yet)', () => {
        render(<I18nProvider>
            <GrokPermissionModeSelector
                agent="grok"
                value="default"
                isDisabled={false}
                onChange={vi.fn()}
            />
        </I18nProvider>)

        const select = screen.getByRole('combobox')
        const values = Array.from(select.querySelectorAll('option')).map((option) => option.getAttribute('value'))
        expect(values).toEqual(['default', 'plan', 'bypassPermissions'])
    })
})
