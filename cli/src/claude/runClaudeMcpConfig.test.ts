import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { systemPrompt } from './utils/systemPrompt'

declare const __dirname: string

const runClaudeSource = readFileSync(resolve(__dirname, 'runClaude.ts'), 'utf8')

describe('Claude HAPI MCP configuration', () => {
    it('uses the hapi_session server name expected by the title prompt', () => {
        expect(runClaudeSource).toContain('mcp__hapi_session__')
        expect(runClaudeSource).toContain("'hapi_session'")
        expect(runClaudeSource).not.toContain('mcp__hapi__')
        expect(runClaudeSource).not.toContain("'hapi':")
    })

    it('does not advertise a local debug log file when file logging is disabled', () => {
        expect(runClaudeSource).not.toContain('Logs: ${logPath}')
        expect(runClaudeSource).toContain('Local file logs: disabled')
    })
})

describe('Claude HAPI title prompt wording', () => {
    it('describes hapi_session tools without claiming it is the whole provider tool universe', () => {
        expect(systemPrompt).toContain('The HAPI-added MCP server named "hapi_session" provides session tools: change_title, report_to_team, mark_team_mention_no_action, and display_image.')
        expect(systemPrompt).toContain('Use report_to_team to post structured Team Chat updates')
        expect(systemPrompt).toContain('Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply')
        expect(systemPrompt).toContain('Other provider, user, project, and global tools may also be available.')
    })
})
