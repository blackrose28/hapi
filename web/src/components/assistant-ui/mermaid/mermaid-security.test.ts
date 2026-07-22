import { beforeAll, describe, expect, it } from 'vitest'
import { renderMermaid } from './mermaid-renderer'

const VALID_DIAGRAMS = [
    'flowchart LR\nA-->B',
    'sequenceDiagram\nA->>B: hello',
    'classDiagram\nclass User',
    'mindmap\n  root((HAPI))\n    CLI\n    Web',
]

const MALICIOUS_DIRECTIVE = `%%{init: {"securityLevel":"loose","themeCSS":"script{display:block}"}}%%
flowchart LR
A["<script>window.__owned=true</script>"]-->B
click A "javascript:alert(1)"`

beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => 800,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: () => 600,
    })
    const getPropertyValue = CSSStyleDeclaration.prototype.getPropertyValue
    CSSStyleDeclaration.prototype.getPropertyValue = function getTestPropertyValue(property: string): string {
        return getPropertyValue.call(this, property)
            || (property.startsWith('padding-') ? '0px' : '')
    }
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
        configurable: true,
        value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
    })
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
        configurable: true,
        value: () => 100,
    })
    const canvasContext = new Proxy({
        measureText: () => ({ width: 100 }),
    }, {
        get: (target, property) => property in target
            ? Reflect.get(target, property)
            : () => undefined,
        set: (target, property, value) => Reflect.set(target, property, value),
    }) as unknown as CanvasRenderingContext2D
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: () => canvasContext,
    })
})

describe('Mermaid security integration', () => {
    for (const [index, code] of VALID_DIAGRAMS.entries()) {
        it(`renders built-in diagram ${index + 1}`, async () => {
            const svg = await renderMermaid({ id: `valid-${index}`, code, theme: 'light' })
            expect(svg).toContain('<svg')
        })
    }

    it('does not allow source directives to weaken security or inject active content', async () => {
        const svg = await renderMermaid({ id: 'malicious', code: MALICIOUS_DIRECTIVE, theme: 'dark' })
        const host = document.createElement('div')
        host.innerHTML = svg
        expect(host.querySelector('script')).toBeNull()
        expect(host.querySelector('[onload], [onclick], [onerror]')).toBeNull()
        const unsafeLink = [...host.querySelectorAll('a')].find((link) =>
            (link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '').startsWith('javascript:'),
        )
        expect(unsafeLink).toBeUndefined()
    })

    it('rejects diagrams above text and edge limits without an injected error SVG', async () => {
        await expect(renderMermaid({
            id: 'too-long',
            code: `flowchart LR\nA[${'x'.repeat(50_001)}]`,
            theme: 'light',
        })).rejects.toBeDefined()
        const edges = Array.from({ length: 501 }, (_, index) => `N${index}-->N${index + 1}`).join('\n')
        await expect(renderMermaid({
            id: 'too-many-edges',
            code: `flowchart LR\n${edges}`,
            theme: 'light',
        })).rejects.toBeDefined()
        expect(document.querySelector('[id^="dtoo-long"], [id^="dtoo-many-edges"]')).toBeNull()
    })
})
