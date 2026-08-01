import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { getHapiSessionToolDefinition, HAPI_SESSION_TOOL_NAMES } from "@/mcp/hapiSessionTools";

export interface StartHappyServerOptions {
    /**
     * Whether to register the `change_title` MCP tool. Defaults to true.
     * Flavors whose native ACP session already syncs its own title (see
     * `registerAcpSessionTitleSync`) should pass false so the model is not
     * told to call a tool that would fight with the native title stream.
     */
    enableChangeTitle?: boolean;
}

export async function startHappyServer(client: ApiSessionClient, options: StartHappyServerOptions = {}) {
    const enableChangeTitle = options.enableChangeTitle ?? true;

    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[hapiMCP] Changing title to:', title);
        try {
            // Send title as a summary message, similar to title generator
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    //
    // Create the MCP server
    //

    const mcp = new McpServer({
        name: "HAPI Session Tools",
        version: "1.0.0",
    });

    if (enableChangeTitle) {
        const changeTitleTool = getHapiSessionToolDefinition('change_title');

        mcp.registerTool<any, any>('change_title', {
            description: changeTitleTool.description,
            title: changeTitleTool.title,
            inputSchema: changeTitleTool.inputSchema,
        }, async (args: { title: string }) => {
            const response = await handler(args.title);
            logger.debug('[hapiMCP] Response:', response);

            if (response.success) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Successfully changed chat title to: "${args.title}"`,
                        },
                    ],
                    isError: false,
                };
            } else {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    const reportToTeamTool = getHapiSessionToolDefinition('report_to_team');
    mcp.registerTool<any, any>('report_to_team', {
        description: reportToTeamTool.description,
        title: reportToTeamTool.title,
        inputSchema: reportToTeamTool.inputSchema,
    }, async (args: Parameters<ApiSessionClient['reportToTeam']>[0]) => {
        try {
            const response = await client.reportToTeam(args);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Posted Team Chat ${args.type} report (${response.message.id}).`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to report to Team Chat: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });

    const markNoActionTool = getHapiSessionToolDefinition('mark_team_mention_no_action');
    mcp.registerTool<any, any>('mark_team_mention_no_action', {
        description: markNoActionTool.description,
        title: markNoActionTool.title,
        inputSchema: markNoActionTool.inputSchema,
    }, async (args: Parameters<ApiSessionClient['markTeamMentionNoAction']>[0]) => {
        try {
            const response = await client.markTeamMentionNoAction(args);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Marked Team mention ${response.request.id} as no action needed.`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to mark Team mention no-action: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });

    const transport = new StreamableHTTPServerTransport({
        // NOTE: Returning session id here will result in claude
        // sdk spawn to fail with `Invalid Request: Server already initialized`
        sessionIdGenerator: undefined
    });
    await mcp.connect(transport);

    //
    // Create the HTTP server
    //

    const server = createServer(async (req, res) => {
        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    return {
        url: baseUrl.toString(),
        toolNames: enableChangeTitle
            ? [...HAPI_SESSION_TOOL_NAMES]
            : HAPI_SESSION_TOOL_NAMES.filter((name) => name !== 'change_title'),
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
