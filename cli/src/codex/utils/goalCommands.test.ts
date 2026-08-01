import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, expect, it } from 'vitest';
import { parseCodexGoalCommand } from './goalCommands';

describe('parseCodexGoalCommand', () => {
    it('parses goal objective set commands', () => {
        expect(parseCodexGoalCommand('/goal ship the feature')).toEqual({
            action: 'set',
            objective: 'ship the feature'
        });
    });

    it('parses empty goal command as get', () => {
        expect(parseCodexGoalCommand('/goal')).toEqual({ action: 'get' });
        expect(parseCodexGoalCommand('  /goal  ')).toEqual({ action: 'get' });
    });

    it('parses goal control commands', () => {
        expect(parseCodexGoalCommand('/goal pause')).toEqual({ action: 'set-status', status: 'paused' });
        expect(parseCodexGoalCommand('/goal resume')).toEqual({ action: 'set-status', status: 'active' });
        expect(parseCodexGoalCommand('/goal clear')).toEqual({ action: 'clear' });
        expect(parseCodexGoalCommand('/goal reset')).toEqual({ action: 'clear' });
        expect(parseCodexGoalCommand('/goal off')).toEqual({ action: 'clear' });
        expect(parseCodexGoalCommand('/goal cancel')).toEqual({ action: 'clear' });
    });

    it('rejects unsupported goal editor command visibly', () => {
        expect(parseCodexGoalCommand('/goal edit')).toEqual({
            action: 'unsupported',
            message: expect.stringContaining('/goal edit')
        });
    });

    it('ignores non-goal commands and text', () => {
        expect(parseCodexGoalCommand('/clear')).toBeNull();
        expect(parseCodexGoalCommand('goal ship it')).toBeNull();
    });
});
