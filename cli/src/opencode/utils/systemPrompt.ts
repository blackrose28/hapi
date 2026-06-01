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
    Use the title tool sparingly. For a new chat, call the tool "hapi_session_change_title" once after the user's initial request is clear, and set a concise task title. Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording. Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    The HAPI-added MCP server named "hapi_session" provides session tools: change_title, report_to_team, mark_team_mention_no_action, and display_image. Use report_to_team to post structured Team Chat updates when you were asked/tagged in a Team Chat, need to report progress, completion, a blocker, a question, or a handoff. Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply. When you create or find a local image file that the user should see, call the tool "hapi_session_display_image" with the image path so HAPI can show it inline. Other provider, user, project, and global tools may also be available.
`);

/**
 * Tool instructions for native ACP sessions. Title updates are synced
 * automatically from OpenCode's own native session title (see
 * `registerAcpSessionTitleSync` / `AcpSdkBackend.refreshSessionInfo`), so the
 * `change_title` tool is not registered and the model is not told to call it.
 */
export const OPENCODE_NATIVE_TOOL_INSTRUCTION = trimIdent(`
    The HAPI-added MCP server named "hapi_session" provides session tools: report_to_team, mark_team_mention_no_action, and display_image. Use report_to_team to post structured Team Chat updates when you were asked/tagged in a Team Chat, need to report progress, completion, a blocker, a question, or a handoff. Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply. When you create or find a local image file that the user should see, call the tool "hapi_session_display_image" with the image path so HAPI can show it inline. Other provider, user, project, and global tools may also be available.
`);

/**
 * The system prompt to inject for OpenCode sessions.
 */
export const opencodeSystemPrompt = TITLE_INSTRUCTION;
