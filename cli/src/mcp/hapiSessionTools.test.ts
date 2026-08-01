import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, expect, it } from 'vitest'
import { HAPI_SESSION_TOOL_DEFINITIONS, HAPI_SESSION_TOOL_NAMES } from './hapiSessionTools'

describe('HAPI session MCP tools', () => {
    it('exposes title, ReportToTeam, and no-action tools', () => {
        expect(HAPI_SESSION_TOOL_NAMES).toEqual(['change_title', 'report_to_team', 'mark_team_mention_no_action'])
    })

    it('validates ReportToTeam input with protocol defaults', () => {
        const reportTool = HAPI_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === 'report_to_team')

        const parsed = reportTool?.inputSchema.parse({
            teamChatId: 'team-1',
            type: 'done',
            summary: 'Implemented the report tool'
        })

        expect(parsed).toEqual({
            teamChatId: 'team-1',
            type: 'done',
            summary: 'Implemented the report tool',
            mentions: [],
            files: []
        })
    })
})


    it('validates mark_team_mention_no_action input', () => {
        const noActionTool = HAPI_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === 'mark_team_mention_no_action')

        const parsed = noActionTool?.inputSchema.parse({ requestId: 'req-1' })

        expect(parsed).toEqual({ requestId: 'req-1' })
    })
