import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { logger } from "@/ui/logger";
import { delay } from "@/utils/time";
import { stat } from "node:fs/promises";
import { watch } from "fs/promises";

export function startFileWatcher(file: string, onFileChange: (file: string) => void) {
    const abortController = new AbortController();
    let lastSignature: string | null = null;

    const pollInterval = setInterval(() => {
        void (async () => {
            try {
                const info = await stat(file);
                const signature = `${info.size}:${info.mtimeMs}`;
                if (lastSignature === null) {
                    lastSignature = signature;
                    logger.debug(`[FILE_WATCHER] File observed by polling: ${file}`);
                    onFileChange(file);
                    return;
                }
                if (signature !== lastSignature) {
                    lastSignature = signature;
                    logger.debug(`[FILE_WATCHER] File changed by polling: ${file}`);
                    onFileChange(file);
                }
            } catch {
                if (lastSignature !== null) {
                    lastSignature = null;
                    logger.debug(`[FILE_WATCHER] File disappeared by polling: ${file}`);
                    onFileChange(file);
                }
            }
        })();
    }, 100);
    pollInterval.unref();

    void (async () => {
        while (true) {
            try {
                logger.debug(`[FILE_WATCHER] Starting watcher for ${file}`);
                const watcher = watch(file, { persistent: true, signal: abortController.signal });
                for await (const event of watcher) {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    logger.debug(`[FILE_WATCHER] File changed: ${file}`);
                    onFileChange(file);
                }
            } catch (e: any) {
                if (abortController.signal.aborted) {
                    return;
                }
                logger.debug(`[FILE_WATCHER] Watch error: ${e.message}, restarting watcher in a second`);
                await delay(1000);
            }
        }
    })();

    return () => {
        abortController.abort();
        clearInterval(pollInterval);
    };
}
