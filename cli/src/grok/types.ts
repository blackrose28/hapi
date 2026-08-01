import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { GrokPermissionMode } from '@hapi/protocol/types';

export type PermissionMode = GrokPermissionMode;

export interface GrokMode {
    permissionMode: PermissionMode;
    model?: string | null;
    effort?: string | null;
}
