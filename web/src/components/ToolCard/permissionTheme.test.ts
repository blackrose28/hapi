import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

declare const __dirname: string

function themeBlock(source: string, selector: ':root' | '[data-theme="dark"]'): string {
    const start = source.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`Missing ${selector} theme block`)
    const bodyStart = source.indexOf('{', start) + 1
    const end = source.indexOf('\n}', bodyStart)
    if (end < 0) throw new Error(`Unclosed ${selector} theme block`)
    return source.slice(bodyStart, end)
}

function hexToken(source: string, token: string): string {
    const match = source.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6});`))
    if (!match?.[1]) throw new Error(`Missing hex token --${token}`)
    return match[1]
}

function luminance(hex: string): number {
    const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    const linear = channels.map((channel) => channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(foreground: string, background: string): number {
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    return (lighter + 0.05) / (darker + 0.05)
}

describe('permission primary theme', () => {
    it.each([':root', '[data-theme="dark"]'] as const)(
        'keeps normal and hover approval contrast AA in %s',
        (selector) => {
            const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')
            const block = themeBlock(css, selector)
            const text = hexToken(block, 'app-primary-action-text')
            const background = hexToken(block, 'app-primary-action-bg')
            const hover = hexToken(block, 'app-primary-action-bg-hover')

            expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5)
            expect(contrast(text, hover)).toBeGreaterThanOrEqual(4.5)
        }
    )
})
