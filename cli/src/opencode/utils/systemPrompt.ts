import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * OpenCode-specific system prompt for change_title tool.
 *
 * OpenCode exposes MCP tools with the naming pattern: <server-name>_<tool-name>
 * The hapi_session MCP server exposes `change_title`, so it's called as `hapi_session_change_title`.
 */

import { trimIdent } from '@/utils/trimIdent';

/**
 * Title instruction for OpenCode to call the hapi MCP tool.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    ALWAYS when you start a new chat - you must call the tool "hapi_session_change_title" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a chance to make it more specific - call the tool again to change it. This title is needed to easily find the chat in the future. Help human.
    The HAPI-added MCP server named "hapi_session" provides session tools: change_title, report_to_team, and mark_team_mention_no_action. Use report_to_team to post structured Team Chat updates when you were asked/tagged in a Team Chat, need to report progress, completion, a blocker, a question, or a handoff. Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply. Other provider, user, project, and global tools may also be available.
`);

/**
 * Tool instructions for native ACP sessions. Title updates are synced
 * automatically from OpenCode's own native session title (see
 * `registerAcpSessionTitleSync` / `AcpSdkBackend.refreshSessionInfo`), so the
 * `change_title` tool is not registered and the model is not told to call it.
 */
export const OPENCODE_NATIVE_TOOL_INSTRUCTION = trimIdent(`
    The HAPI-added MCP server named "hapi_session" provides session tools: report_to_team and mark_team_mention_no_action. Use report_to_team to post structured Team Chat updates when you were asked/tagged in a Team Chat, need to report progress, completion, a blocker, a question, or a handoff. Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply. Other provider, user, project, and global tools may also be available.
`);

/**
 * The system prompt to inject for OpenCode sessions.
 */
export const opencodeSystemPrompt = TITLE_INSTRUCTION;
