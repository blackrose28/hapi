import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
export function buildOpencodeEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env
    };
}
