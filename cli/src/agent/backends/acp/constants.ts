import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
export const ACP_SESSION_UPDATE_TYPES = {
    agentMessageChunk: 'agent_message_chunk',
    agentThoughtChunk: 'agent_thought_chunk',
    toolCall: 'tool_call',
    toolCallUpdate: 'tool_call_update',
    plan: 'plan',
    sessionInfoUpdate: 'session_info_update',
    usageUpdate: 'usage_update'
} as const;
