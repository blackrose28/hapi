import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Converter from SDK message types to log format (RawJSONLines)
 * Transforms Claude SDK messages into the format expected by session logs
 */

import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import type {
    SDKMessage,
    SDKUserMessage,
    SDKAssistantMessage,
    SDKSystemMessage,
    SDKResultMessage
} from '@/claude/sdk'
import type { RawJSONLines } from '@/claude/types'
import type { ClaudePermissionMode } from '@hapi/protocol/types'
import { logger } from '@/lib'

/**
 * SDK message types this converter knows how to turn into a transcript line.
 *
 * Anything outside this set is dropped. Claude Code keeps adding out-of-band
 * SDK events (`tool_progress` heartbeats, stream events, control responses),
 * and they are not conversation content — passing them through would stamp
 * them with transcript base fields (parentUuid/sessionId/userType), which
 * makes them indistinguishable from a real log line downstream. The web
 * normalizer can't match them to any known shape and falls back to rendering
 * the raw envelope as message text, leaking JSON into the chat.
 *
 * The local launcher already enforces the same allowlist via
 * `RawJSONLinesSchema.safeParse` in sessionScanner; this keeps the remote
 * (SDK) path at parity instead of leaving it open by default.
 */
const CONVERTIBLE_SDK_MESSAGE_TYPES = new Set([
    'user',
    'assistant',
    'system',
    'result',
    'tool_result'
])

/**
 * Context for converting SDK messages to log format
 */
export interface ConversionContext {
    sessionId: string
    cwd: string
    version?: string
    gitBranch?: string
    parentUuid?: string | null
}

type PermissionResponse = {
    approved: boolean
    mode?: ClaudePermissionMode
    reason?: string
}

/**
 * SDK message types that must never reach the session log.
 *
 * The `default:` branch of convert() deliberately passes unknown SDK message
 * types through so new signals stay visible while we learn to render them.
 * Types listed here are the exception: they carry no conversation content, so
 * passing them through only surfaces the raw `{ type: 'output', data: ... }`
 * envelope as a text blob in the web UI (the normalizer has no branch for
 * them and falls back to stringifying).
 *
 * - `tool_progress`: periodic heartbeat while a tool runs long
 *   (`heartbeat: true`, `elapsed_time_seconds`, `parent_tool_use_id`).
 */
const SUPPRESSED_SDK_MESSAGE_TYPES = new Set<string>([
    'tool_progress'
])

/**
 * Get current git branch for the working directory
 */
function getGitBranch(cwd: string): string | undefined {
    try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
        return branch || undefined
    } catch {
        return undefined
    }
}

/**
 * SDK to Log converter class
 * Maintains state for parent-child relationships between messages
 */
export class SDKToLogConverter {
    private lastUuid: string | null = null
    private context: ConversionContext
    private responses?: Map<string, PermissionResponse>
    private sidechainLastUUID = new Map<string, string>();

    constructor(
        context: Omit<ConversionContext, 'parentUuid'>,
        responses?: Map<string, PermissionResponse>
    ) {
        this.context = {
            ...context,
            gitBranch: context.gitBranch ?? getGitBranch(context.cwd),
            version: context.version ?? process.env.npm_package_version ?? '0.0.0',
            parentUuid: null
        }
        this.responses = responses
    }

    /**
     * Update session ID (for when session changes during resume)
     */
    updateSessionId(sessionId: string): void {
        this.context.sessionId = sessionId
    }

    /**
     * Reset parent chain (useful when starting new conversation)
     */
    resetParentChain(): void {
        this.lastUuid = null
        this.context.parentUuid = null
    }

    /**
     * Convert rate_limit_event to pipe-delimited text matching the ACP path format.
     * 'allowed' is forwarded too (as a silent quota status update, never shown as a
     * chat bubble) so the web app can track live utilization continuously instead
     * of only near a limit. Must not mutate converter state (UUID chain) so dropped
     * events (unknown/malformed) are invisible.
     */
    private convertRateLimitEvent(sdkMessage: SDKMessage): RawJSONLines | null {
        const info = (sdkMessage as any).rate_limit_info
        if (typeof info !== 'object' || info === null) return null

        const { status, resetsAt, utilization, rateLimitType } = info

        if (typeof resetsAt !== 'number') return null

        const resetsAtInt = Math.round(resetsAt)
        const limitType = typeof rateLimitType === 'string' ? rateLimitType : ''
        const pct = typeof utilization === 'number' ? Math.round(utilization * 100) : null
        let text: string

        if (status === 'allowed') {
            text = `Claude AI usage status|${resetsAtInt}|${pct ?? ''}|${limitType}`
        } else if (status === 'allowed_warning') {
            text = `Claude AI usage limit warning|${resetsAtInt}|${pct ?? ''}|${limitType}`
        } else if (status === 'rejected') {
            text = `Claude AI usage limit reached|${resetsAtInt}|${limitType}`
        } else {
            return null
        }

        const parentUuid = this.lastUuid
        const uuid = randomUUID()
        const timestamp = new Date().toISOString()
        this.lastUuid = uuid

        return {
            parentUuid,
            isSidechain: false,
            userType: 'external' as const,
            cwd: this.context.cwd,
            sessionId: this.context.sessionId,
            version: this.context.version,
            gitBranch: this.context.gitBranch,
            uuid,
            timestamp,
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text }]
            }
        } as RawJSONLines
    }

    /**
     * Convert SDK message to log format
     */
    convert(sdkMessage: SDKMessage): RawJSONLines | null {
        if (sdkMessage.type === 'rate_limit_event') {
            return this.convertRateLimitEvent(sdkMessage)
        }

        // Bail before allocating a uuid or touching sidechain/parent tracking —
        // an unknown event must not advance the transcript chain it never joins.
        if (!CONVERTIBLE_SDK_MESSAGE_TYPES.has(sdkMessage.type) || SUPPRESSED_SDK_MESSAGE_TYPES.has(sdkMessage.type)) {
            logger.debug(`[sdkToLogConverter] dropping unsupported SDK message type: ${sdkMessage.type}`)
            return null
        }

        const uuid = randomUUID()
        const timestamp = new Date().toISOString()
        let parentUuid = this.lastUuid;
        let isSidechain = false;
        if (sdkMessage.parent_tool_use_id) {
            isSidechain = true;
            parentUuid = this.sidechainLastUUID.get((sdkMessage as any).parent_tool_use_id) ?? null;
            this.sidechainLastUUID.set((sdkMessage as any).parent_tool_use_id!, uuid);
        }
        const baseFields = {
            parentUuid: parentUuid,
            isSidechain: isSidechain,
            userType: 'external' as const,
            cwd: this.context.cwd,
            sessionId: this.context.sessionId,
            version: this.context.version,
            gitBranch: this.context.gitBranch,
            uuid,
            timestamp
        }

        let logMessage: RawJSONLines | null = null

        switch (sdkMessage.type) {
            case 'user': {
                const userMsg = sdkMessage as SDKUserMessage
                logMessage = {
                    ...baseFields,
                    type: 'user',
                    message: userMsg.message,
                    ...(userMsg.tool_use_result === undefined
                        ? {}
                        : { toolUseResult: userMsg.tool_use_result })
                }

                // Claude Code injects its own user-role turns (skill bodies, compact
                // continuation summaries). Over stream-json they are flagged
                // `isSynthetic`, while the on-disk transcript the local launcher reads
                // flags them `isMeta`. Normalize to `isMeta` so both paths hit the same
                // downstream filters — otherwise the injected text reaches the web UI
                // and is rendered as if the human had typed it.
                if (userMsg.isSynthetic === true || userMsg.isMeta === true) {
                    logMessage.isMeta = true
                }

                // Check if this is a tool result and add mode if available
                if (Array.isArray(userMsg.message.content)) {
                    for (const content of userMsg.message.content) {
                        if (content.type === 'tool_result' && content.tool_use_id && this.responses?.has(content.tool_use_id)) {
                            const response = this.responses.get(content.tool_use_id)
                            if (response?.mode) {
                                (logMessage as any).mode = response.mode
                            }
                        }
                    }
                } else if (typeof userMsg.message.content === 'string') {
                    // Simple string content, no tool result
                }
                break
            }

            case 'assistant': {
                const assistantMsg = sdkMessage as SDKAssistantMessage
                logMessage = {
                    ...baseFields,
                    type: 'assistant',
                    message: assistantMsg.message,
                    // Assistant messages often have additional fields
                    requestId: (assistantMsg as any).requestId
                }
                // if (assistantMsg.message.content && Array.isArray(assistantMsg.message.content)) {
                //     for (const content of assistantMsg.message.content) {
                //         if (content.type === 'tool_use' && content.id) {
                //             this.sidechainLastUUID.set(content.id, uuid);
                //         }
                //     }
                // }
                break
            }

            case 'system': {
                const systemMsg = sdkMessage as SDKSystemMessage

                // System messages with subtype 'init' might update session ID
                if (systemMsg.subtype === 'init' && systemMsg.session_id) {
                    this.updateSessionId(systemMsg.session_id)
                }

                // System messages are typically not sent to logs
                // but we can convert them if needed
                logMessage = {
                    ...baseFields,
                    type: 'system',
                    subtype: systemMsg.subtype,
                    model: systemMsg.model,
                    tools: systemMsg.tools,
                    // Include all other fields
                    ...(systemMsg as any)
                }
                break
            }

            case 'result': {
                // Result messages are not converted to log messages
                // They're SDK-specific messages that indicate session completion
                // Not part of the actual conversation log
                break
            }

            // Handle tool use results (often comes as user messages)
            case 'tool_result': {
                const toolMsg = sdkMessage as any
                const baseLogMessage: any = {
                    ...baseFields,
                    type: 'user',
                    message: {
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            tool_use_id: toolMsg.tool_use_id,
                            content: toolMsg.content
                        }]
                    },
                    toolUseResult: toolMsg.content
                }

                // Add mode if available from responses
                if (toolMsg.tool_use_id && this.responses?.has(toolMsg.tool_use_id)) {
                    const response = this.responses.get(toolMsg.tool_use_id)
                    if (response?.mode) {
                        baseLogMessage.mode = response.mode
                    }
                }

                logMessage = baseLogMessage
                break
            }

            default:
                // Unreachable: CONVERTIBLE_SDK_MESSAGE_TYPES gates this switch.
                // Kept as a fail-closed guard so that adding a type to the set
                // without a matching case here drops the message instead of
                // passing an unshaped envelope through to the chat.
                logger.debug(`[sdkToLogConverter] no case for allowlisted type: ${(sdkMessage as any).type}`)
                break
        }

        // Update last UUID for parent tracking
        if (logMessage && logMessage.type !== 'summary') {
            this.lastUuid = uuid
        }

        return logMessage
    }

    /**
     * Convert multiple SDK messages to log format
     */
    convertMany(sdkMessages: SDKMessage[]): RawJSONLines[] {
        return sdkMessages
            .map(msg => this.convert(msg))
            .filter((msg): msg is RawJSONLines => msg !== null)
    }

    /**
     * Convert a simple string content to a sidechain user message
     * Used for Task tool sub-agent prompts
     */
    convertSidechainUserMessage(toolUseId: string, content: string): RawJSONLines {
        const uuid = randomUUID()
        const timestamp = new Date().toISOString()
        this.sidechainLastUUID.set(toolUseId, uuid);
        return {
            parentUuid: null,
            isSidechain: true,
            userType: 'external' as const,
            cwd: this.context.cwd,
            sessionId: this.context.sessionId,
            version: this.context.version,
            gitBranch: this.context.gitBranch,
            type: 'user',
            message: {
                role: 'user',
                content: content
            },
            uuid,
            timestamp
        }
    }

    /**
     * Generate an interrupted tool result message
     * Used when a tool call is interrupted by the user
     * @param toolUseId - The ID of the tool that was interrupted
     * @param parentToolUseId - Optional parent tool ID if this is a sidechain tool
     */
    generateInterruptedToolResult(toolUseId: string, parentToolUseId?: string | null): RawJSONLines {
        const uuid = randomUUID()
        const timestamp = new Date().toISOString()
        const errorMessage = "[Request interrupted by user for tool use]"
        
        // Determine if this is a sidechain and get parent UUID
        let isSidechain = false
        let parentUuid: string | null = this.lastUuid
        
        if (parentToolUseId) {
            isSidechain = true
            // Look up the parent tool's UUID
            parentUuid = this.sidechainLastUUID.get(parentToolUseId) ?? null
            // Track this tool in the sidechain map
            this.sidechainLastUUID.set(parentToolUseId, uuid)
        }
        
        const logMessage: RawJSONLines = {
            type: 'user',
            isSidechain: isSidechain,
            uuid,
            message: {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        content: errorMessage,
                        is_error: true,
                        tool_use_id: toolUseId
                    }
                ]
            },
            parentUuid: parentUuid,
            userType: 'external' as const,
            cwd: this.context.cwd,
            sessionId: this.context.sessionId,
            version: this.context.version,
            gitBranch: this.context.gitBranch,
            timestamp,
            toolUseResult: `Error: ${errorMessage}`
        } as any
        
        // Update last UUID for tracking
        this.lastUuid = uuid
        
        return logMessage
    }
}

/**
 * Convenience function for one-off conversions
 */
export function convertSDKToLog(
    sdkMessage: SDKMessage,
    context: Omit<ConversionContext, 'parentUuid'>,
    responses?: Map<string, PermissionResponse>
): RawJSONLines | null {
    const converter = new SDKToLogConverter(context, responses)
    return converter.convert(sdkMessage)
}
