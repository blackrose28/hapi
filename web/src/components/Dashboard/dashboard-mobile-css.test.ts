import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

declare const __dirname: string

const dashboardCss = readFileSync(resolve(__dirname, 'dashboard.css'), 'utf8')
const indexCss = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')

describe('mobile dashboard CSS', () => {
    it('replaces the mobile Mission Control title area with the Editor action', () => {
        expect(dashboardCss).toMatch(/@media \(max-width: 600px\)[\s\S]*\.db__topbar-left\s*\{[\s\S]*display:\s*none;/)
        expect(dashboardCss).toMatch(/@media \(max-width: 600px\)[\s\S]*\.db__topbar-btn--editor\s*\{[\s\S]*display:\s*flex;[\s\S]*order:\s*-1;/)
        expect(dashboardCss).toMatch(/@media \(max-width: 600px\)[\s\S]*\.db__topbar-btn--editor\s+\.db__label\s*\{[\s\S]*display:\s*inline;/)
    })

    it('uses the adjusted font scales as the defaults', () => {
        expect(indexCss).toContain('font-size: calc(120% * var(--app-font-scale, 1));')
        expect(indexCss).toContain('font-size: calc(105% * var(--app-font-scale, 1));')
        expect(indexCss).not.toContain('font-size: calc(95% * var(--app-font-scale, 1));')
        expect(indexCss).not.toContain('font-size: calc(87.5% * var(--app-font-scale, 1));')
    })

    it('scales desktop pinned chat markdown down one step', () => {
        expect(dashboardCss).toMatch(/@media \(min-width: 768px\)[\s\S]*\.db-pinned--compact\s+\.aui-md\s*\{[\s\S]*font-size:\s*0\.8125rem\s*!important;/)
        expect(dashboardCss).toMatch(/@media \(min-width: 768px\)[\s\S]*\.db-pinned--compact\s+\.aui-md\s*\{[\s\S]*line-height:\s*1\.15rem\s*!important;/)
    })

    it('does not style the task badge as an icon action', () => {
        expect(dashboardCss).not.toContain('.db-pinned__compact-action--tasks')
    })

    it('uses the approved compact header behavior on mobile', () => {
        expect(dashboardCss).toMatch(/@media \(max-width: 768px\)[\s\S]*\.db-pinned__compact-path-trigger\s*\{[\s\S]*display:\s*none;/)
        expect(dashboardCss).toMatch(/@media \(max-width: 768px\)[\s\S]*\.db-pinned__compact-action--focus[\s\S]*\.db-pinned__compact-action--team\s*\{[\s\S]*display:\s*none;/)
        expect(dashboardCss).toMatch(/@media \(max-width: 768px\)[\s\S]*\.db-pinned__compact-membership-overflow\s*\{[\s\S]*display:\s*none;/)
    })

    it('keeps compact membership overflow on one desktop header row', () => {
        expect(dashboardCss).toMatch(/\.db-pinned__compact-membership-overflow\s*\{[\s\S]*flex-shrink:\s*0;/)
    })

    it('adapts compact runtime controls to their panel width and rendered control count', () => {
        expect(indexCss).toMatch(/\.compact-composer__status\s*\{[\s\S]*container-type:\s*inline-size;/)
        expect(indexCss).toMatch(/@container \(max-width: 520px\)[\s\S]*\.compact-runtime-controls__selectors\s*\{[\s\S]*grid-template-columns:\s*repeat\(var\(--compact-runtime-control-count\),\s*minmax\(0,\s*1fr\)\);/)
        expect(indexCss).toMatch(/@media \(max-width: 520px\)[\s\S]*\.compact-runtime-controls__selectors\s*\{[\s\S]*grid-template-columns:\s*repeat\(var\(--compact-runtime-control-count\),\s*minmax\(0,\s*1fr\)\);/)
        expect(indexCss).not.toMatch(/@media \(max-width: 520px\)[\s\S]*\.compact-runtime-controls\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,/)
    })
})
