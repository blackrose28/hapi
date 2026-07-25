import { describe, expect, it } from 'vitest';
import { isInternalEventJson } from './internalEventFilter';

describe('isInternalEventJson', () => {
    it('returns false for non-JSON text', () => {
        expect(isInternalEventJson('Hello world')).toBe(false);
    });

    it('returns false for JSON without a type field', () => {
        expect(isInternalEventJson('{"foo":"bar"}')).toBe(false);
    });

    it('returns true for the leaked session metadata envelope', () => {
        const json = JSON.stringify({
            type: 'output',
            data: {
                parentUuid: 'abc-123',
                isSidechain: false,
                userType: 'external',
                cwd: '/home/user/project',
                sessionId: 'session-456',
                version: '0.0.0',
                uuid: 'def-789',
                timestamp: '2026-04-05T00:00:00Z',
            },
        });
        expect(isInternalEventJson(json)).toBe(true);
    });

    it('returns true for minimal metadata envelope shape', () => {
        const json = JSON.stringify({
            type: 'output',
            data: {
                parentUuid: 'abc',
                sessionId: '123',
                userType: 'external',
            },
        });
        expect(isInternalEventJson(json)).toBe(true);
    });

    it('returns true for root metadata envelope with parentUuid: null', () => {
        const json = JSON.stringify({
            type: 'output',
            data: {
                parentUuid: null,
                sessionId: '123',
                userType: 'external',
            },
        });
        expect(isInternalEventJson(json)).toBe(true);
    });

    it('returns false for output with non-metadata data', () => {
        // Legitimate output that happens to have type "output" but different data shape
        const json = JSON.stringify({
            type: 'output',
            data: { text: 'some result' },
        });
        expect(isInternalEventJson(json)).toBe(false);
    });

    it('returns false for { type: "event" } — not the leaked shape', () => {
        const json = JSON.stringify({ type: 'event', data: { type: 'ready' } });
        expect(isInternalEventJson(json)).toBe(false);
    });

    it('returns false for { type: "queue-operation" } — not the leaked shape', () => {
        const json = JSON.stringify({ type: 'queue-operation', op: 'enqueue' });
        expect(isInternalEventJson(json)).toBe(false);
    });

    it('returns false for other JSON types (assistant, user)', () => {
        expect(isInternalEventJson('{"type":"assistant"}')).toBe(false);
        expect(isInternalEventJson('{"type":"user"}')).toBe(false);
    });

    it('returns false for invalid JSON starting with {', () => {
        expect(isInternalEventJson('{not valid json')).toBe(false);
    });

    it('returns false when output data is not an object', () => {
        const json = JSON.stringify({ type: 'output', data: 'string-data' });
        expect(isInternalEventJson(json)).toBe(false);
    });

    describe('multiple concatenated envelopes', () => {
        const heartbeat = (index: number) => JSON.stringify({
            type: 'output',
            data: {
                parentUuid: index === 0 ? null : `parent-${index}`,
                isSidechain: true,
                userType: 'external',
                cwd: '/data/Work/AI/LangBot',
                sessionId: 'session-456',
                version: '0.18.5-sharedhub',
                uuid: `uuid-${index}`,
                timestamp: '2026-07-25T04:52:27.873Z',
                type: 'tool_progress',
                tool_use_id: `toolu_abc-heartbeat-${index}`,
                tool_name: 'Bash',
                elapsed_time_seconds: (index + 1) * 30,
                heartbeat: true,
            },
        });

        it('returns true for envelopes separated by blank lines', () => {
            const text = `${heartbeat(0)}\n\n${heartbeat(1)}\n\n${heartbeat(2)}`;
            expect(isInternalEventJson(text)).toBe(true);
        });

        it('returns true for envelopes with no separator at all', () => {
            expect(isInternalEventJson(`${heartbeat(0)}${heartbeat(1)}`)).toBe(true);
        });

        it('returns true for envelopes with leading and trailing whitespace', () => {
            expect(isInternalEventJson(`\n  ${heartbeat(0)}\n${heartbeat(1)}\n  `)).toBe(true);
        });

        it('returns false when any object in the sequence is not an envelope', () => {
            const text = `${heartbeat(0)}\n\n${JSON.stringify({ type: 'assistant' })}`;
            expect(isInternalEventJson(text)).toBe(false);
        });

        it('returns false when prose follows the envelopes', () => {
            expect(isInternalEventJson(`${heartbeat(0)}\n\nHere is the answer.`)).toBe(false);
        });

        it('returns false when the trailing envelope is truncated mid-stream', () => {
            const text = `${heartbeat(0)}\n\n${heartbeat(1).slice(0, -20)}`;
            expect(isInternalEventJson(text)).toBe(false);
        });

        it('is not confused by braces inside string values', () => {
            const json = JSON.stringify({
                type: 'output',
                data: {
                    parentUuid: null,
                    sessionId: '123',
                    userType: 'external',
                    tool_input: 'echo "{\\"nested\\": \\"}}}\\"}"',
                },
            });
            expect(isInternalEventJson(`${json}\n${heartbeat(1)}`)).toBe(true);
        });

        it('returns false for a JSON array of envelopes', () => {
            expect(isInternalEventJson(`[${heartbeat(0)},${heartbeat(1)}]`)).toBe(false);
        });
    });
});
