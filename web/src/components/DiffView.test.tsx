import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { DiffView } from './DiffView'

describe('DiffView overflow behavior', () => {
    afterEach(() => cleanup())

    it('delegates long-line scrolling to its parent without clipping or wrapping', () => {
        const longLine = 'x'.repeat(400)

        render(
            <I18nProvider>
                <DiffView
                    oldString="old"
                    newString={longLine}
                    variant="inline"
                    overflowMode="parent-scroll"
                />
            </I18nProvider>
        )

        const line = screen.getByText(`+ ${longLine}`)
        const diffRoot = line.closest('.rounded-md')
        expect(diffRoot).toHaveClass('overflow-visible')
        expect(diffRoot).not.toHaveClass('overflow-hidden')
        expect(line).toHaveClass('whitespace-pre')
        expect(line).not.toHaveClass('whitespace-pre-wrap')
    })
})
