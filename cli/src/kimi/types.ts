import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { KimiPermissionMode } from '@hapi/protocol/types';

export type PermissionMode = KimiPermissionMode;

export interface KimiMode {
    permissionMode: PermissionMode;
    model?: string;
}
