import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, expect, it } from 'vitest';
import { AcpStdioTransport } from './AcpStdioTransport';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
