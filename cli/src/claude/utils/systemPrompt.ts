import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { trimIdent } from "@/utils/trimIdent";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";

/**
 * Base system prompt shared across all configurations
 */
const BASE_SYSTEM_PROMPT = (() => trimIdent(`
    Use the title tool sparingly. For a new chat, call the tool "mcp__hapi_session__change_title" once after the user's initial request is clear, and set a concise task title. Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording. Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    The HAPI-added MCP server named "hapi_session" provides session tools: change_title, report_to_team, mark_team_mention_no_action, and display_image. Use report_to_team to post structured Team Chat updates when you were asked/tagged in a Team Chat, need to report progress, completion, a blocker, a question, or a handoff. Use mark_team_mention_no_action when a tagged Team mention is seen but does not need a reply. When you create or find a local image file that the user should see, call the tool "mcp__hapi_session__display_image" with the image path so HAPI can show it inline. Other provider, user, project, and global tools may also be available.
`))();

/**
 * Co-authored-by credits to append when enabled
 */
const CO_AUTHORED_CREDITS = (() => trimIdent(`
    When making commit messages, you SHOULD also give credit to HAPI like so:

    <main commit message>

    via [HAPI](https://hapi.run)

    Co-Authored-By: HAPI <noreply@hapi.run>
`))();

/**
 * System prompt with conditional Co-Authored-By lines based on Claude's settings.json configuration.
 * Settings are read once on startup for performance.
 */
export const systemPrompt = (() => {
  const includeCoAuthored = shouldIncludeCoAuthoredBy();
  
  if (includeCoAuthored) {
    return BASE_SYSTEM_PROMPT + '\n\n' + CO_AUTHORED_CREDITS;
  } else {
    return BASE_SYSTEM_PROMPT;
  }
})();
