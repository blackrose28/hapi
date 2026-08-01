import { asString, isObject } from '@hapi/protocol';
import { AcpStdioTransport } from '@/agent/backends/acp/AcpStdioTransport';
import packageJson from '../../../package.json';
import { getErrorMessage } from './rpcResponses';

export interface GrokModelSummary {
    modelId: string;
    name?: string;
}

export interface GrokEffortSummary {
    effortId: string;
    name?: string;
}

export interface ListGrokModelsForCwdRequest {
    cwd?: string;
}

export interface ListGrokModelsForCwdResponse {
    success: boolean;
    availableModels?: GrokModelSummary[];
    currentModelId?: string | null;
    availableEfforts?: GrokEffortSummary[];
    currentEffortId?: string | null;
    error?: string;
}

interface CacheEntry {
    expiresAt: number;
    response: ListGrokModelsForCwdResponse;
}

const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ListGrokModelsForCwdResponse>>();

function normalizeAvailableModels(rawModels: unknown): GrokModelSummary[] {
    if (!Array.isArray(rawModels)) return [];
    const out: GrokModelSummary[] = [];
    for (const entry of rawModels) {
        if (!isObject(entry)) continue;
        const modelId = asString(entry.modelId);
        if (!modelId) continue;
        const name = asString(entry.name) ?? undefined;
        out.push(name ? { modelId, name } : { modelId });
    }
    return out;
}

function extractModelsFromResponse(response: unknown): {
    availableModels: GrokModelSummary[];
    currentModelId: string | null;
    availableEfforts: GrokEffortSummary[];
    currentEffortId: string | null;
} {
    if (!isObject(response)) {
        return { availableModels: [], currentModelId: null, availableEfforts: [], currentEffortId: null };
    }

    const directList = response.availableModels;
    const directCurrent = response.currentModelId;
    const nested = isObject(response.models) ? response.models : null;
    const nestedList = nested?.availableModels;
    const nestedCurrent = nested?.currentModelId;

    let configModels: GrokModelSummary[] = [];
    let configCurrentModelId: string | null = null;
    let availableEfforts: GrokEffortSummary[] = [];
    let currentEffortId: string | null = null;
    if (Array.isArray(response.configOptions)) {
        for (const option of response.configOptions) {
            if (!isObject(option)) continue;
            const id = asString(option.id);
            const currentValue = asString(option.currentValue);
            const rawOptions = Array.isArray(option.options) ? option.options : [];
            if (id === 'model') {
                configCurrentModelId = currentValue ?? null;
                configModels = normalizeAvailableModels(rawOptions.map((entry) => {
                    if (!isObject(entry)) return null;
                    return {
                        modelId: asString(entry.value),
                        name: asString(entry.name) ?? undefined
                    };
                }));
            }
            if (id === 'effort') {
                currentEffortId = currentValue ?? null;
                availableEfforts = rawOptions.flatMap((entry): GrokEffortSummary[] => {
                    if (!isObject(entry)) return [];
                    const effortId = asString(entry.value);
                    if (!effortId) return [];
                    const name = asString(entry.name) ?? undefined;
                    return [name ? { effortId, name } : { effortId }];
                });
            }
        }
    }

    const rawModels = Array.isArray(directList)
        ? directList
        : Array.isArray(nestedList)
            ? nestedList
            : null;
    const rawCurrent = typeof directCurrent === 'string'
        ? directCurrent
        : typeof nestedCurrent === 'string'
            ? nestedCurrent
            : null;

    return {
        availableModels: rawModels ? normalizeAvailableModels(rawModels) : configModels,
        currentModelId: rawCurrent ?? configCurrentModelId,
        availableEfforts,
        currentEffortId
    };
}

/**
 * Probe a `grok --cwd <cwd> agent stdio` subprocess over ACP the same way
 * `createGrokBackend` (cli/src/grok/utils/grokBackend.ts) does at session
 * launch time. Passing `--cwd` at process start (not just via session/new)
 * ensures Grok discovers the correct project rules/plugins for the requested
 * directory — this is what keeps model discovery scoped to the session cwd
 * rather than to wherever the CLI happened to be invoked from.
 */
async function runGrokProbe(cwd: string): Promise<ListGrokModelsForCwdResponse> {
    const transport = new AcpStdioTransport({
        command: 'grok',
        args: ['--cwd', cwd, 'agent', 'stdio']
    });

    try {
        const initResponse = await transport.sendRequest('initialize', {
            protocolVersion: 1,
            clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false
            },
            clientInfo: {
                name: 'hapi-grok-models',
                version: packageJson.version
            }
        }, { timeoutMs: PROBE_TIMEOUT_MS });

        if (!isObject(initResponse) || typeof initResponse.protocolVersion !== 'number') {
            return { success: false, error: 'Invalid initialize response from grok agent' };
        }

        const newResponse = await transport.sendRequest('session/new', {
            cwd,
            mcpServers: []
        }, { timeoutMs: PROBE_TIMEOUT_MS });

        const { availableModels, currentModelId, availableEfforts, currentEffortId } = extractModelsFromResponse(newResponse);

        return {
            success: true,
            availableModels,
            currentModelId,
            availableEfforts,
            currentEffortId
        };
    } finally {
        await transport.close().catch(() => undefined);
    }
}

/**
 * Discover available Grok models for a given working directory by spawning a
 * short-lived `grok --cwd <cwd> agent stdio` subprocess, sending `initialize`
 * + `session/new`, and capturing the `availableModels`/`currentModelId` (and
 * `effort` configOption) snapshot from the response. The subprocess is torn
 * down immediately afterwards.
 *
 * Results are cached per cwd for 60 seconds; concurrent requests for the same
 * cwd are coalesced via a single-flight promise so we never spawn more than
 * one probe at a time per cwd.
 */
export async function listGrokModelsForCwd(
    cwd: string
): Promise<ListGrokModelsForCwdResponse> {
    const trimmed = cwd?.trim();
    if (!trimmed) {
        return { success: false, error: 'cwd is required' };
    }

    const cached = cache.get(trimmed);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.response;
    }

    const existing = inflight.get(trimmed);
    if (existing) {
        return existing;
    }

    const promise = (async () => {
        try {
            const response = await runGrokProbe(trimmed);
            if (response.success) {
                cache.set(trimmed, {
                    expiresAt: Date.now() + CACHE_TTL_MS,
                    response
                });
            }
            return response;
        } catch (error) {
            return {
                success: false,
                error: getErrorMessage(error, 'Failed to discover Grok models')
            } satisfies ListGrokModelsForCwdResponse;
        } finally {
            inflight.delete(trimmed);
        }
    })();

    inflight.set(trimmed, promise);
    return promise;
}

/**
 * Clear the in-process cache. Exposed for tests.
 */
export function _resetGrokModelsCacheForTests(): void {
    cache.clear();
    inflight.clear();
}
