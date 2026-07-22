import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ClaudeModelPolicyResult = {
    blocked: boolean
    availableModels: string[] | null
}

export type ClaudeModelPolicyOptions = {
    cwd: string
    env: Record<string, string | undefined>
    managedSettingsPaths?: string[]
}

const MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const

function getModelFamily(value: string): typeof MODEL_FAMILIES[number] | null {
    const normalized = value.toLowerCase()
    return MODEL_FAMILIES.find((family) => (
        new RegExp(`(^|[./_-])${family}(?=$|[./_\\-\\[])`).test(normalized)
    )) ?? null
}

function isFamilyAlias(value: string, family: string): boolean {
    return value.toLowerCase() === family
}

function matchesSpecificModel(modelId: string, allowedModel: string): boolean {
    return modelId === allowedModel
        || modelId.startsWith(`${allowedModel}-`)
        || modelId.startsWith(`${allowedModel}[`)
}

export function filterModelsByAvailableModels<T extends { id: string }>(
    models: T[],
    availableModels: string[] | null
): T[] {
    if (availableModels === null) {
        return models
    }

    const familiesWithSpecificEntries = new Set(
        availableModels
            .map((entry) => ({ entry, family: getModelFamily(entry) }))
            .filter(({ entry, family }) => family !== null && !isFamilyAlias(entry, family))
            .map(({ family }) => family)
    )

    return models.filter((model) => availableModels.some((allowedModel) => {
        const family = getModelFamily(allowedModel)
        if (family && isFamilyAlias(allowedModel, family)) {
            return !familiesWithSpecificEntries.has(family)
                && getModelFamily(model.id) === family
        }
        return matchesSpecificModel(model.id, allowedModel)
    }))
}

type SettingsReadResult =
    | { status: 'missing' }
    | { status: 'invalid' }
    | { status: 'valid'; value: Record<string, unknown> }

function deduplicate(values: string[]): string[] {
    return [...new Set(values)]
}

function readAvailableModels(
    settings: Record<string, unknown>,
    strict: boolean
): { valid: boolean; present: boolean; models: string[] } {
    if (!Object.hasOwn(settings, 'availableModels')) {
        return { valid: true, present: false, models: [] }
    }

    if (!Array.isArray(settings.availableModels)) {
        return { valid: !strict, present: false, models: [] }
    }

    const models = settings.availableModels
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)

    if (strict && models.length !== settings.availableModels.length) {
        return { valid: false, present: true, models: [] }
    }

    return { valid: true, present: true, models }
}

async function readSettings(path: string): Promise<SettingsReadResult> {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { status: 'invalid' }
        }
        return { status: 'valid', value: parsed as Record<string, unknown> }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { status: 'missing' }
        }
        return { status: 'invalid' }
    }
}

function managedSettingsLocation(env: Record<string, string | undefined>): {
    file: string
    directory: string
} {
    if (process.platform === 'darwin') {
        const base = '/Library/Application Support/ClaudeCode'
        return {
            file: join(base, 'managed-settings.json'),
            directory: join(base, 'managed-settings.d')
        }
    }

    if (process.platform === 'win32') {
        const base = join(env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode')
        return {
            file: join(base, 'managed-settings.json'),
            directory: join(base, 'managed-settings.d')
        }
    }

    return {
        file: '/etc/claude-code/managed-settings.json',
        directory: '/etc/claude-code/managed-settings.d'
    }
}

async function defaultManagedSettingsPaths(
    env: Record<string, string | undefined>
): Promise<{ blocked: boolean; paths: string[] }> {
    const location = managedSettingsLocation(env)
    try {
        const entries = await readdir(location.directory, { withFileTypes: true })
        const dropIns = entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => join(location.directory, entry.name))
            .sort()
        return { blocked: false, paths: [location.file, ...dropIns] }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { blocked: false, paths: [location.file] }
        }
        return { blocked: true, paths: [] }
    }
}

export async function resolveClaudeAvailableModels(
    options: ClaudeModelPolicyOptions
): Promise<ClaudeModelPolicyResult> {
    const managedPathsResult = options.managedSettingsPaths
        ? { blocked: false, paths: options.managedSettingsPaths }
        : await defaultManagedSettingsPaths(options.env)

    if (managedPathsResult.blocked) {
        return { blocked: true, availableModels: null }
    }

    const managedModels: string[] = []
    let hasManagedAllowlist = false
    for (const path of managedPathsResult.paths) {
        const result = await readSettings(path)
        if (result.status === 'invalid') {
            return { blocked: true, availableModels: null }
        }
        if (result.status === 'missing') {
            continue
        }

        const availableModels = readAvailableModels(result.value, true)
        if (!availableModels.valid) {
            return { blocked: true, availableModels: null }
        }
        if (availableModels.present) {
            hasManagedAllowlist = true
            managedModels.push(...availableModels.models)
        }
    }

    if (hasManagedAllowlist) {
        return { blocked: false, availableModels: deduplicate(managedModels) }
    }

    const configDir = options.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
    const settingsPaths = [
        join(configDir, 'settings.json'),
        join(options.cwd, '.claude', 'settings.json'),
        join(options.cwd, '.claude', 'settings.local.json')
    ]
    const availableModels: string[] = []
    let hasAllowlist = false
    for (const path of settingsPaths) {
        const result = await readSettings(path)
        if (result.status !== 'valid') {
            continue
        }

        const setting = readAvailableModels(result.value, false)
        if (setting.present) {
            hasAllowlist = true
            availableModels.push(...setting.models)
        }
    }

    return {
        blocked: false,
        availableModels: hasAllowlist ? deduplicate(availableModels) : null
    }
}
