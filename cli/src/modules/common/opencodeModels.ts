import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { asString, isObject } from '@hapi/protocol';
import { AcpStdioTransport } from '@/agent/backends/acp/AcpStdioTransport';
import packageJson from '../../../package.json';
import { getErrorMessage } from './rpcResponses';

export interface OpencodeModelSummary {
    modelId: string;
    name?: string;
}

export interface OpencodeEffortSummary {
    effortId: string;
    name?: string;
}

export interface ListOpencodeModelsForCwdRequest {
    cwd?: string;
}

export interface ListOpencodeModelsForCwdResponse {
    success: boolean;
    availableModels?: OpencodeModelSummary[];
    currentModelId?: string | null;
    availableEfforts?: OpencodeEffortSummary[];
    currentEffortId?: string | null;
    error?: string;
}

interface CacheEntry {
    expiresAt: number;
    response: ListOpencodeModelsForCwdResponse;
}

const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ListOpencodeModelsForCwdResponse>>();

function normalizeAvailableModels(rawModels: unknown): OpencodeModelSummary[] {
    if (!Array.isArray(rawModels)) return [];
    const out: OpencodeModelSummary[] = [];
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
    availableModels: OpencodeModelSummary[];
    currentModelId: string | null;
    availableEfforts: OpencodeEffortSummary[];
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

    let configModels: OpencodeModelSummary[] = [];
    let configCurrentModelId: string | null = null;
    let availableEfforts: OpencodeEffortSummary[] = [];
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
                availableEfforts = rawOptions.flatMap((entry): OpencodeEffortSummary[] => {
                    if (!isObject(entry)) return [];
                    const effortId = asString(entry.value);
                    if (!effortId) return [];
                    const name = asString(entry.name) ?? undefined;
                    return [name ? { effortId, name } : { effortId }];
                });
            }
        }
    }
    const meta = isObject(response._meta) && isObject(response._meta.opencode)
        ? response._meta.opencode
        : null;
    if (meta) {
        const variant = asString(meta.variant);
        if (variant !== null) {
            currentEffortId = variant;
        }
        if (Array.isArray(meta.availableVariants)) {
            availableEfforts = meta.availableVariants.flatMap((entry): OpencodeEffortSummary[] => {
                const effortId = asString(entry);
                if (!effortId) return [];
                return [{ effortId, name: formatEffortName(effortId) }];
            });
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

function formatEffortName(effortId: string): string {
    return effortId
        .split(/[_-]/)
        .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
        .join(' ');
}

async function runOpencodeProbe(cwd: string): Promise<ListOpencodeModelsForCwdResponse> {
    const transport = new AcpStdioTransport({
        command: 'opencode',
        args: ['acp']
    });

    try {
        const initResponse = await transport.sendRequest('initialize', {
            protocolVersion: 1,
            clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false
            },
            clientInfo: {
                name: 'hapi-opencode-models',
                version: packageJson.version
            }
        }, { timeoutMs: PROBE_TIMEOUT_MS });

        if (!isObject(initResponse) || typeof initResponse.protocolVersion !== 'number') {
            return { success: false, error: 'Invalid initialize response from opencode acp' };
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
 * Discover available OpenCode models for a given working directory by spawning
 * a short-lived `opencode acp` subprocess, sending `initialize` + `session/new`,
 * and capturing the `availableModels` / `currentModelId` snapshot from the
 * response. The subprocess is torn down immediately afterwards.
 *
 * Results are cached per cwd for 60 seconds; concurrent requests for the same
 * cwd are coalesced via a single-flight promise so we never spawn more than
 * one probe at a time per cwd.
 */
export async function listOpencodeModelsForCwd(
    cwd: string
): Promise<ListOpencodeModelsForCwdResponse> {
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
            const response = await runOpencodeProbe(trimmed);
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
                error: getErrorMessage(error, 'Failed to discover OpenCode models')
            } satisfies ListOpencodeModelsForCwdResponse;
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
export function _resetOpencodeModelsCacheForTests(): void {
    cache.clear();
    inflight.clear();
}
