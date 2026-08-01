import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
export type CodexGoalCommand =
    | { action: 'get' }
    | { action: 'clear' }
    | { action: 'set'; objective: string }
    | { action: 'set-status'; status: 'active' | 'paused' }
    | { action: 'unsupported'; message: string };

const CLEAR_WORDS = new Set(['clear', 'reset', 'off', 'cancel']);

export function parseCodexGoalCommand(message: string): CodexGoalCommand | null {
    const match = /^\s*\/goal(?:\s+([\s\S]*?))?\s*$/.exec(message);
    if (!match) return null;

    const rest = match[1]?.trim() ?? '';
    if (!rest) return { action: 'get' };

    const normalized = rest.toLowerCase();
    if (CLEAR_WORDS.has(normalized)) return { action: 'clear' };
    if (normalized === 'pause') return { action: 'set-status', status: 'paused' };
    if (normalized === 'resume') return { action: 'set-status', status: 'active' };
    if (normalized === 'edit') {
        return {
            action: 'unsupported',
            message: '/goal edit is not supported in HAPI yet. Use /goal <objective>, /goal pause, /goal resume, or /goal clear.'
        };
    }

    return { action: 'set', objective: rest };
}
