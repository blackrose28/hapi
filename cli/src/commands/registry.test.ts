import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, expect, it, vi } from 'vitest'
import { resolveCommand } from './registry'

describe('registry gemini tombstone', () => {
    it('resolves `gemini` to a dedicated tombstone command instead of falling through to Claude', () => {
        const { command } = resolveCommand(['gemini'])

        // Regression: deleting the gemini command entry outright made
        // resolveCommand() treat 'gemini' as unknown and fall back to
        // claudeCommand, forwarding "gemini" as an arg (silently starting
        // Claude instead of reporting the sunset). A dedicated command named
        // 'gemini' must be resolved.
        expect(command.name).toBe('gemini')
    })

    it('prints a clear sunset error and exits 1 instead of silently starting Claude', async () => {
        const { command, context } = resolveCommand(['gemini', '--yolo'])
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit:${code ?? 'undefined'}`)
        }) as never)

        try {
            await expect(command.run(context)).rejects.toThrow('process.exit:1')
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('no longer supported')
            )
        } finally {
            consoleErrorSpy.mockRestore()
            exitSpy.mockRestore()
        }
    })
})
