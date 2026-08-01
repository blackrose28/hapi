import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Unified MCP bridge setup for Codex local and remote modes.
 *
 * This module provides a single source of truth for starting the hapi MCP
 * bridge server and generating the MCP server configuration that Codex needs.
 */

import { startHappyServer, type StartHappyServerOptions } from '@/claude/utils/startHappyServer';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import type { ApiSessionClient } from '@/api/apiSession';
import { exportHapiSessionEnv } from '@/agent/hapiSessionEnv';

/**
 * MCP server entry configuration.
 */
export interface McpServerEntry {
    command: string;
    args: string[];
}

/**
 * Map of MCP server names to their configurations.
 */
export type McpServersConfig = Record<string, McpServerEntry>;

/**
 * Options accepted by {@link buildHapiMcpBridge}, passed through to
 * {@link startHappyServer}.
 */
export type HapiMcpBridgeOptions = StartHappyServerOptions;

/**
 * Result of starting the hapi MCP bridge.
 */
export interface HapiMcpBridge {
    /** The running server instance */
    server: {
        url: string;
        stop: () => void;
    };
    /** MCP server config to pass to Codex (works for both CLI and SDK) */
    mcpServers: McpServersConfig;
}

/**
 * Start the hapi MCP bridge server and return the configuration
 * needed to connect Codex to it.
 *
 * This is the single source of truth for MCP bridge setup,
 * used by both local and remote launchers.
 *
 * `bootstrapSession` already exports `HAPI_SESSION_ID` for the current session
 * before any launcher runs; the export here is belt-and-suspenders so it holds
 * even if a caller ever reaches this bridge with a session client that didn't
 * go through that path.
 */
export async function buildHapiMcpBridge(
    client: ApiSessionClient,
    options: HapiMcpBridgeOptions = {}
): Promise<HapiMcpBridge> {
    exportHapiSessionEnv(client.sessionId);

    const happyServer = await startHappyServer(client, options);
    const bridgeCommand = getHappyCliCommand(['mcp', '--url', happyServer.url]);

    return {
        server: {
            url: happyServer.url,
            stop: happyServer.stop
        },
        mcpServers: {
            hapi_session: {
                command: bridgeCommand.command,
                args: bridgeCommand.args
            }
        }
    };
}
