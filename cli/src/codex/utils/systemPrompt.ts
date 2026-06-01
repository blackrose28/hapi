import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the hapi__change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';

/**
 * Title instruction for Codex to call the hapi MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.hapi_session__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Use the title tool sparingly. For a new chat, call it once after the user's initial request is clear, and set a concise task title.
    Prefer calling functions.hapi_session__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi_session__change_title, mcp__hapi_session__change_title, or hapi_session_change_title.
    Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording.
    Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    The HAPI-added MCP server named "hapi_session" provides session tools: change_title, report_to_team, mark_team_mention_no_action, and display_image. Use report_to_team to post structured Team Chat updates when you were asked/tagged in a Team Chat, need to report progress, completion, a blocker, a question, or a handoff. Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply. When you create or find a local image file that the user should see, call functions.hapi_session__display_image with the image path.
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export const codexSystemPrompt = TITLE_INSTRUCTION;
