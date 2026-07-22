import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

declare const __dirname: string

function cssBlock(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`Missing ${selector} block`)
    const bodyStart = source.indexOf('{', start) + 1
    const end = source.indexOf('\n}', bodyStart)
    if (end < 0) throw new Error(`Unclosed ${selector} block`)
    return source.slice(bodyStart, end)
}

describe('SessionTaskListControl theme CSS', () => {
    it('uses a light surface by default and preserves the approved dark surface', () => {
        const css = readFileSync(resolve(__dirname, 'SessionTaskListControl.css'), 'utf8')
        const lightDialog = cssBlock(css, '.session-task-dialog')
        const darkDialog = cssBlock(css, '[data-theme="dark"] .session-task-dialog')

        expect(lightDialog).toContain('--session-task-surface: #f8fafc;')
        expect(lightDialog).toContain('background: var(--session-task-surface);')
        expect(lightDialog).toContain('color: var(--session-task-text);')
        expect(darkDialog).toContain('--session-task-surface: #181c21;')
        expect(css).toContain('background: var(--session-task-track);')
        expect(css).toContain('background: var(--session-task-row-hover);')
        expect(css).toContain('background: var(--session-task-surface);')
    })
})
