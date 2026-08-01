import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { logger } from '@/ui/logger';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import {
    listGrokModelsForCwd,
    type ListGrokModelsForCwdRequest,
    type ListGrokModelsForCwdResponse
} from '../grokModels';
import { getErrorMessage, rpcError } from '../rpcResponses';

export function registerGrokModelHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<ListGrokModelsForCwdRequest, ListGrokModelsForCwdResponse>(
        'listGrokModelsForCwd',
        async (data) => {
            logger.debug('List Grok models for cwd request', { cwd: data?.cwd });

            try {
                const cwd = typeof data?.cwd === 'string' ? data.cwd : '';
                return await listGrokModelsForCwd(cwd);
            } catch (error) {
                logger.debug('Failed to list Grok models:', error);
                return rpcError(getErrorMessage(error, 'Failed to list Grok models'));
            }
        }
    );
}
