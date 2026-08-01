import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { describe, expect, it } from 'vitest'
import { ApiMachineClient } from './apiMachine'
import type { Machine } from './types'
import type { RpcHandlerManager } from './rpc/RpcHandlerManager'

function createMachine(): Machine {
    return {
        id: 'machine-test',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'localhost',
            platform: 'linux',
            happyCliVersion: '0.1.0',
            homeDir: '/home/user',
            happyHomeDir: '/home/user/.hapi',
            happyLibDir: '/home/user/.hapi/lib'
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1
    }
}

describe('ApiMachineClient editor RPC registration', () => {
    it('registers session-less editor RPC handlers on the machine scope', () => {
        const client = new ApiMachineClient({ kind: 'runner', credential: { credentialId: 'cred', secret: 'x'.repeat(32) }, machineId: 'machine' }, createMachine(), '/tmp/workspace') as unknown as {
            rpcHandlerManager: RpcHandlerManager
        }

        expect(client.rpcHandlerManager.hasHandler('editor-list-directory')).toBe(true)
        expect(client.rpcHandlerManager.hasHandler('editor-read-file')).toBe(true)
        expect(client.rpcHandlerManager.hasHandler('editor-list-projects')).toBe(true)
        expect(client.rpcHandlerManager.hasHandler('editor-git-status-v2')).toBe(true)
    })
})
