import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
export interface EmbeddedAsset {
    relativePath: string;
    sourcePath: string;
}

export async function loadEmbeddedAssets(): Promise<EmbeddedAsset[]> {
    throw new Error('Embedded assets are only available in Bun-compiled binaries.');
}
