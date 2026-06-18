import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, type IncomingMessage } from "node:http";
import { lstat, readFile } from "node:fs/promises";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { getHapiSessionToolDefinition, HAPI_SESSION_TOOL_NAMES } from "@/mcp/hapiSessionTools";
import { detectImageMimeType, registerGeneratedImage } from "@/modules/common/generatedImages";

export interface StartHappyServerOptions {
    /**
     * Whether to register the `change_title` MCP tool. Defaults to true.
     * Flavors whose native ACP session already syncs its own title (see
     * `registerAcpSessionTitleSync`) should pass false so the model is not
     * told to call a tool that would fight with the native title stream.
     */
    enableChangeTitle?: boolean;
}

function createHapiMcpServer(client: ApiSessionClient, options: StartHappyServerOptions): McpServer {
    const enableChangeTitle = options.enableChangeTitle ?? true;

    const handler = async (title: string) => {
        logger.debug('[hapiMCP] Changing title to:', title);
        try {
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

    const displayImageInputSchema: z.ZodTypeAny = z.object({
        path: z.string().describe('Local filesystem path of the image to display to the user'),
        title: z.string().optional().describe('Optional display title or filename for the image'),
    });

    mcp.registerTool<any, any>('display_image', {
        description: 'Display a local image file inline in the current HAPI chat session',
        title: 'Display Image',
        inputSchema: displayImageInputSchema,
    }, async (args: { path: string; title?: string }) => {
        logger.debug('[hapiMCP] Display image:', args.path);

        try {
            const info = await lstat(args.path);
            if (!info.isFile()) {
                throw new Error('Path is not a regular file');
            }

            const maxImageBytes = 25 * 1024 * 1024;
            if (info.size > maxImageBytes) {
                throw new Error('Image is too large to display inline');
            }

            const bytes = await readFile(args.path);
            const mimeType = detectImageMimeType(bytes);
            if (!mimeType) {
                throw new Error('Unsupported image content');
            }

            const image = registerGeneratedImage({
                id: randomUUID(),
                path: args.path,
                fileName: args.title,
                mimeType,
                bytes
            });

            client.sendAgentMessage({
                type: 'generated-image',
                imageId: image.id,
                fileName: image.fileName,
                mimeType: image.mimeType,
                id: randomUUID()
            });

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Displayed image: ${image.fileName}`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.debug('[hapiMCP] Failed to display image:', message);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to display image: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });

    return mcp;
}

function readMcpSessionId(req: IncomingMessage): string | undefined {
    const raw = req.headers['mcp-session-id'];
    if (typeof raw === 'string') {
        return raw;
    }
    if (Array.isArray(raw)) {
        return raw[0];
    }
    return undefined;
}

export async function startHappyServer(client: ApiSessionClient, options: StartHappyServerOptions = {}) {
    const enableChangeTitle = options.enableChangeTitle ?? true;
    const transports = new Map<string, StreamableHTTPServerTransport>();
    const mcps = new Map<string, McpServer>();

    const createMcpTransport = () => {
        const mcp = createHapiMcpServer(client, options);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
                transports.set(sessionId, transport);
                mcps.set(sessionId, mcp);
            },
            onsessionclosed: (sessionId) => {
                transports.delete(sessionId);
                const server = mcps.get(sessionId);
                mcps.delete(sessionId);
                void server?.close();
            },
        });
        void mcp.connect(transport);
        return transport;
    };

    const server = createServer(async (req, res) => {
        try {
            const sessionId = readMcpSessionId(req);
            const transport = sessionId
                ? transports.get(sessionId)
                : createMcpTransport();

            if (!transport) {
                if (!res.headersSent) {
                    res.writeHead(404).end();
                }
                return;
            }

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

    const mcpUrl = baseUrl.toString();
    client.updateMetadata((metadata) => ({
        ...metadata,
        hapiMcpUrl: mcpUrl,
    }));

    const toolNames = enableChangeTitle
        ? [...HAPI_SESSION_TOOL_NAMES, 'display_image']
        : [...HAPI_SESSION_TOOL_NAMES.filter((name) => name !== 'change_title'), 'display_image'];

    return {
        url: mcpUrl,
        toolNames,
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            for (const mcp of mcps.values()) {
                mcp.close();
            }
            transports.clear();
            mcps.clear();
            server.close();
        }
    };
}
