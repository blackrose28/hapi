import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

declare const __dirname: string

const indexCss = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')

describe('Mermaid fullscreen CSS', () => {
    it('lets the canvas fill remaining space below a wrapped header and safe areas', () => {
        expect(indexCss).toMatch(/\.mermaid-preview:fullscreen\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
        expect(indexCss).toMatch(/\.mermaid-preview:fullscreen \.mermaid-preview__canvas\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/s)
        expect(indexCss).toMatch(/\.mermaid-preview:fullscreen \.mermaid-preview__source\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*auto;/s)
        expect(indexCss).not.toContain('height: calc(100vh - 48px);')
    })
})
