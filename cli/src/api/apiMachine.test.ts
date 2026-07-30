import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
    ioMock: vi.fn(),
    listOpencodeModelsForCwdMock: vi.fn()
}))

const { ioMock, listOpencodeModelsForCwdMock } = mocks

vi.mock('socket.io-client', () => ({
    io: mocks.ioMock
}))

vi.mock('@/api/auth', () => ({
    getAuthToken: () => 'cli-token'
}))

vi.mock('../modules/common/opencodeModels', () => ({
    listOpencodeModelsForCwd: mocks.listOpencodeModelsForCwdMock
}))

import { ApiMachineClient } from './apiMachine'
import type { Machine } from './types'
import { TerminalManager } from '@/terminal/TerminalManager'

class FakeSocket {
    readonly emitted: Array<{ event: string; data: unknown }> = []
    readonly handlers = new Map<string, (...args: unknown[]) => void>()
    readonly close = vi.fn()
    readonly emitWithAck = vi.fn(async () => ({ result: 'success', version: 1, runnerState: null, metadata: null }))

    on(event: string, handler: (...args: unknown[]) => void): this {
        this.handlers.set(event, handler)
        return this
    }

    emit(event: string, data: unknown): boolean {
        this.emitted.push({ event, data })
        return true
    }

    trigger(event: string, data?: unknown): void {
        this.handlers.get(event)?.(data)
    }
}

function makeMachine(id: string): Machine {
    return {
        id,
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: null,
        metadataVersion: 0,
        runnerState: null,
        runnerStateVersion: 0
    }
}

async function callListOpencodeModels(client: ApiMachineClient, machineId: string, cwd: string): Promise<unknown> {
    // Reach into the private rpc handler manager to dispatch a request.
    // Mirrors how the on-socket 'rpc-request' listener invokes handleRequest.
    const manager = (client as unknown as { rpcHandlerManager: { handleRequest: (req: { method: string; params: string }) => Promise<string> } }).rpcHandlerManager
    const raw = await manager.handleRequest({
        method: `${machineId}:listOpencodeModelsForCwd`,
        params: JSON.stringify({ cwd })
    })
    return JSON.parse(raw) as unknown
}

describe('ApiMachineClient listOpencodeModelsForCwd handler', () => {
    let workspaceRoot: string

    beforeEach(() => {
        ioMock.mockReset()
        listOpencodeModelsForCwdMock.mockReset()
        workspaceRoot = mkdtempSync(join(tmpdir(), 'hapi-machine-ws-'))
    })

    afterEach(() => {
        rmSync(workspaceRoot, { recursive: true, force: true })
    })

    it('rejects cwd outside the workspace root with the standard error shape', async () => {
        const machine = makeMachine('machine-1')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)

        const outsideCwd = mkdtempSync(join(tmpdir(), 'hapi-outside-'))
        try {
            const result = await callListOpencodeModels(client, machine.id, outsideCwd)
            expect(result).toEqual({ success: false, error: 'Path is outside workspace root' })
            expect(listOpencodeModelsForCwdMock).not.toHaveBeenCalled()
        } finally {
            rmSync(outsideCwd, { recursive: true, force: true })
            client.shutdown()
        }
    })

    it('rejects empty cwd with cwd-required error', async () => {
        const machine = makeMachine('machine-2')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)

        try {
            const result = await callListOpencodeModels(client, machine.id, '')
            expect(result).toEqual({ success: false, error: 'cwd is required' })
            expect(listOpencodeModelsForCwdMock).not.toHaveBeenCalled()
        } finally {
            client.shutdown()
        }
    })

    it('forwards a workspace-internal cwd to listOpencodeModelsForCwd', async () => {
        const machine = makeMachine('machine-3')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)

        const innerDir = join(workspaceRoot, 'inner-project')
        mkdirSync(innerDir)

        listOpencodeModelsForCwdMock.mockResolvedValueOnce({
            success: true,
            availableModels: [{ modelId: 'a/b' }],
            currentModelId: 'a/b'
        })

        try {
            const result = await callListOpencodeModels(client, machine.id, innerDir)
            expect(result).toEqual({
                success: true,
                availableModels: [{ modelId: 'a/b' }],
                currentModelId: 'a/b'
            })
            expect(listOpencodeModelsForCwdMock).toHaveBeenCalledTimes(1)
            // The handler should pass the resolved (realpath'd) cwd to the lower layer.
            expect(listOpencodeModelsForCwdMock).toHaveBeenCalledWith(expect.stringContaining('inner-project'))
        } finally {
            client.shutdown()
        }
    })
})

describe('ApiMachineClient terminal legacy boundary', () => {
    let workspaceRoot: string
    let socket: FakeSocket
    let terminalSpies: {
        create: ReturnType<typeof vi.spyOn>
        write: ReturnType<typeof vi.spyOn>
        resize: ReturnType<typeof vi.spyOn>
        close: ReturnType<typeof vi.spyOn>
        detach: ReturnType<typeof vi.spyOn>
        getHistory: ReturnType<typeof vi.spyOn>
        closeAll: ReturnType<typeof vi.spyOn>
    }

    beforeEach(() => {
        ioMock.mockReset()
        listOpencodeModelsForCwdMock.mockReset()
        workspaceRoot = mkdtempSync(join(tmpdir(), 'hapi-machine-terminal-ws-'))
        socket = new FakeSocket()
        ioMock.mockReturnValue(socket)
        terminalSpies = {
            create: vi.spyOn(TerminalManager.prototype, 'create').mockImplementation(() => {}),
            write: vi.spyOn(TerminalManager.prototype, 'write').mockImplementation(() => {}),
            resize: vi.spyOn(TerminalManager.prototype, 'resize').mockImplementation(() => {}),
            close: vi.spyOn(TerminalManager.prototype, 'close').mockImplementation(() => {}),
            detach: vi.spyOn(TerminalManager.prototype, 'detach').mockImplementation(() => {}),
            getHistory: vi.spyOn(TerminalManager.prototype, 'getHistory').mockReturnValue({
                machineId: 'machine-1',
                terminalId: 'tm',
                requestId: 'request-1',
                status: 'ok',
                shell: 'bash',
                entries: [{ index: 7, command: 'pwd' }]
            }),
            closeAll: vi.spyOn(TerminalManager.prototype, 'closeAll').mockImplementation(() => {})
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
        rmSync(workspaceRoot, { recursive: true, force: true })
    })

    it('keeps machine terminal events on the legacy single-terminal path', () => {
        const machine = makeMachine('machine-1')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)
        client.connect()

        socket.trigger('terminal:open', { machineId: 'machine-1', terminalId: 'tm', cols: 120, rows: 40 })
        socket.trigger('terminal:write', { machineId: 'machine-1', terminalId: 'tm', data: 'ls\n' })
        socket.trigger('terminal:resize', { machineId: 'machine-1', terminalId: 'tm', cols: 100, rows: 30 })
        socket.trigger('terminal:detach', { machineId: 'machine-1', terminalId: 'tm' })
        socket.trigger('terminal:close', { machineId: 'machine-1', terminalId: 'tm' })

        expect(terminalSpies.create).toHaveBeenCalledWith('tm', 120, 40, undefined, false)
        expect(terminalSpies.write).toHaveBeenCalledWith('tm', 'ls\n')
        expect(terminalSpies.resize).toHaveBeenCalledWith('tm', 100, 30)
        expect(terminalSpies.detach).toHaveBeenCalledWith('tm')
        expect(terminalSpies.close).toHaveBeenCalledWith('tm')
        expect(socket.handlers.has('terminal:list')).toBe(false)
        expect(socket.handlers.has('terminal:keepalive')).toBe(false)
        expect(socket.handlers.has('terminal:close-all')).toBe(false)

        client.shutdown()
    })

    it('advertises terminal history support during the runner socket handshake', () => {
        const machine = makeMachine('machine-1')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)

        client.connect()

        expect(ioMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                auth: expect.objectContaining({
                    capabilities: expect.arrayContaining(['terminal-history-v1'])
                })
            })
        )
        client.shutdown()
    })

    it('returns live history for a valid machine terminal request', () => {
        const machine = makeMachine('machine-1')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)
        client.connect()

        socket.trigger('terminal:history', {
            machineId: 'machine-1',
            terminalId: 'tm',
            requestId: 'request-1',
            limit: 50
        })

        expect(terminalSpies.getHistory).toHaveBeenCalledWith({
            machineId: 'machine-1',
            terminalId: 'tm',
            requestId: 'request-1',
            limit: 50
        })
        expect(socket.emitted).toContainEqual({
            event: 'terminal:history-result',
            data: {
                machineId: 'machine-1',
                terminalId: 'tm',
                requestId: 'request-1',
                status: 'ok',
                shell: 'bash',
                entries: [{ index: 7, command: 'pwd' }]
            }
        })

        client.shutdown()
    })

    it('ignores terminal events for another machine id', () => {
        const machine = makeMachine('machine-1')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)
        client.connect()

        socket.trigger('terminal:open', { machineId: 'other-machine', terminalId: 'tm', cols: 120, rows: 40 })
        socket.trigger('terminal:write', { machineId: 'other-machine', terminalId: 'tm', data: 'ls\n' })
        socket.trigger('terminal:resize', { machineId: 'other-machine', terminalId: 'tm', cols: 100, rows: 30 })
        socket.trigger('terminal:detach', { machineId: 'other-machine', terminalId: 'tm' })
        socket.trigger('terminal:close', { machineId: 'other-machine', terminalId: 'tm' })

        expect(terminalSpies.create).not.toHaveBeenCalled()
        expect(terminalSpies.write).not.toHaveBeenCalled()
        expect(terminalSpies.resize).not.toHaveBeenCalled()
        expect(terminalSpies.detach).not.toHaveBeenCalled()
        expect(terminalSpies.close).not.toHaveBeenCalled()

        client.shutdown()
    })

    it('closes all machine terminals on socket disconnect using legacy cleanup', () => {
        const machine = makeMachine('machine-1')
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, machine, workspaceRoot)
        client.connect()

        socket.trigger('disconnect')

        expect(terminalSpies.closeAll).toHaveBeenCalledTimes(1)
    })
})
