import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ApiSessionClient } from '@/api/apiSession'
import { startHappyServer } from './startHappyServer'

let stopServer: (() => void) | null = null
let client: Client | null = null

afterEach(async () => {
    await client?.close()
    client = null
    stopServer?.()
    stopServer = null
})

function createSessionClient(): ApiSessionClient {
    return {
        updateMetadata: () => {},
        sendAgentMessage: () => {},
        sendClaudeSessionMessage: () => {},
        reportToTeam: async () => ({ message: { id: 'msg-1' } }),
        markTeamMentionNoAction: async () => ({ request: { id: 'req-1' } })
    } as unknown as ApiSessionClient
}

describe('startHappyServer change_title gating', () => {
    it('exposes change_title by default', async () => {
        const server = await startHappyServer(createSessionClient())
        stopServer = server.stop

        expect(server.toolNames).toContain('change_title')

        const mcp = new Client({ name: 'hapi-test', version: '1.0.0' })
        client = mcp
        await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        const tools = await mcp.listTools()

        expect(tools.tools.map((tool) => tool.name)).toContain('change_title')
    })

    it('does not expose change_title when native ACP titles are enabled', async () => {
        const server = await startHappyServer(createSessionClient(), { enableChangeTitle: false })
        stopServer = server.stop

        expect(server.toolNames).not.toContain('change_title')
        expect(server.toolNames).toEqual(['report_to_team', 'mark_team_mention_no_action'])

        const mcp = new Client({ name: 'hapi-test', version: '1.0.0' })
        client = mcp
        await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        const tools = await mcp.listTools()

        expect(tools.tools.map((tool) => tool.name)).not.toContain('change_title')
    })
})
