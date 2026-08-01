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
    ALWAYS when you start a new chat, call the title tool to set a concise task title.
    Prefer calling functions.hapi_session__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi_session__change_title, mcp__hapi_session__change_title, or hapi_session_change_title.
    If the task focus changes significantly later, call the title tool again with a better title.
    The HAPI-added MCP server named "hapi_session" provides session tools: change_title, report_to_team, and mark_team_mention_no_action. Use report_to_team to post structured Team Chat updates when you were asked/tagged in a Team Chat, need to report progress, completion, a blocker, a question, or a handoff. Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply. Other provider, user, project, and global tools may also be available.
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export const codexSystemPrompt = TITLE_INSTRUCTION;
