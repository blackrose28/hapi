import { describe, expect, it, afterEach, test, vi } from 'vitest';
import { AcpStdioTransport } from './AcpStdioTransport';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const spawnState = vi.hoisted(() => ({
    exitHandlers: [] as Array<(code: number | null, signal: NodeJS.Signals | null) => void>,
    stdinWrite: vi.fn<(chunk: string) => boolean>(() => true),
    exitCode: null as number | null
}));

vi.mock('node:child_process', () => ({
    spawn: vi.fn(() => {
        spawnState.exitHandlers = [];
        const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
        const proc = {
            get exitCode() {
                return spawnState.exitCode;
            },
            stdout: {
                setEncoding: vi.fn(),
                on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
                    handlers.set(`stdout:${event}`, [...(handlers.get(`stdout:${event}`) ?? []), handler]);
                })
            },
            stderr: {
                setEncoding: vi.fn(),
                on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
                    handlers.set(`stderr:${event}`, [...(handlers.get(`stderr:${event}`) ?? []), handler]);
                })
            },
            stdin: {
                end: vi.fn(),
                write: (chunk: string) => spawnState.stdinWrite(chunk)
            },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
                if (event === 'exit') {
                    spawnState.exitHandlers.push(handler as (code: number | null, signal: NodeJS.Signals | null) => void);
                }
                handlers.set(`proc:${event}`, [...(handlers.get(`proc:${event}`) ?? []), handler]);
            }),
            kill: vi.fn()
        };
        return proc;
    })
}));

describe('AcpStdioTransport', () => {
    it('uses the same 14-day default timeout as Codex app-server requests', () => {
        const transportStatics = AcpStdioTransport as unknown as {
            HUNG_TIMEOUT_MS: number;
        };

        expect(transportStatics.HUNG_TIMEOUT_MS).toBe(14 * 24 * 60 * 60 * 1000);
    });

    it('rejects no-timeout requests after the ACP process has exited', async () => {
        const transport = new AcpStdioTransport({
            command: 'sh',
            args: ['-c', 'exit 0']
        });

        await sleep(50);

        const result = await Promise.race([
            transport.sendRequest('session/prompt', {}, { timeoutMs: Infinity })
                .then(() => 'resolved', (error) => error instanceof Error ? error.message : String(error)),
            sleep(100).then(() => 'timed-out')
        ]);

        await transport.close();

        expect(result).toMatch(/ACP process exited|not running|closed/i);
    });
});

describe('AcpStdioTransport closed stdin writes', () => {
    afterEach(() => {
        spawnState.stdinWrite.mockReset();
        spawnState.stdinWrite.mockReturnValue(true);
        spawnState.exitCode = null;
        spawnState.exitHandlers = [];
    });

    test('rejects new requests after the ACP process exits instead of throwing from stdin.write', async () => {
        const transport = new AcpStdioTransport({ command: 'gemini' });
        spawnState.exitCode = 1;
        spawnState.stdinWrite.mockImplementation(() => {
            throw new Error('WritableIterable is closed');
        });

        for (const handler of spawnState.exitHandlers) {
            handler(1, null);
        }

        await expect(transport.sendRequest('session/new')).rejects.toThrow(
            'ACP process exited (code=1, signal=null)'
        );
        expect(() => transport.sendNotification('session/cancel', {})).not.toThrow();
    });

    test('rejects pending requests when stdin.write throws', async () => {
        spawnState.stdinWrite.mockImplementation(() => {
            throw new Error('WritableIterable is closed');
        });

        const transport = new AcpStdioTransport({ command: 'gemini' });
        await expect(transport.sendRequest('initialize')).rejects.toThrow('WritableIterable is closed');
        await expect(transport.sendRequest('session/new')).rejects.toThrow('WritableIterable is closed');
    });
});
