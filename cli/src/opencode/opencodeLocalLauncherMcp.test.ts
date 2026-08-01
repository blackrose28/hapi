import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

declare const __dirname: string

const launcherSource = readFileSync(resolve(__dirname, 'opencodeLocalLauncher.ts'), 'utf8')

describe('OpenCode local HAPI MCP configuration', () => {
    it('passes the renamed hapi_session MCP server to opencode config generation', () => {
        expect(launcherSource).toContain('bridge.mcpServers.hapi_session')
        expect(launcherSource).not.toContain('bridge.mcpServers.hapi,')
    })
})
