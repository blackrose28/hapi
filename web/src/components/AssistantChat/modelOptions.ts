import { MODEL_OPTIONS } from '@/components/NewSession/types'
import { getClaudeComposerModelOptions, getNextClaudeComposerModel } from './claudeModelOptions'
import type { ClaudeComposerModelOption } from './claudeModelOptions'

export type ModelOption = ClaudeComposerModelOption

function normalizeCurrentModel(model?: string | null): string | null {
    const trimmedModel = model?.trim()
    if (!trimmedModel || trimmedModel === 'auto' || trimmedModel === 'default') {
        return null
    }

    return trimmedModel
}

function withCurrentModelOption(options: ModelOption[], currentModel?: string | null): ModelOption[] {
    const normalizedCurrentModel = normalizeCurrentModel(currentModel)
    if (!normalizedCurrentModel || options.some((option) => option.value === normalizedCurrentModel)) {
        return options
    }

    const nextOptions = [...options]
    const autoIndex = nextOptions.findIndex((option) => option.value === null)
    nextOptions.splice(autoIndex >= 0 ? autoIndex + 1 : 0, 0, {
        value: normalizedCurrentModel,
        label: normalizedCurrentModel
    })
    return nextOptions
}

function getGeminiModelOptions(currentModel?: string | null): ModelOption[] {
    const options = MODEL_OPTIONS.gemini.map((m) => ({
        value: m.value === 'auto' ? null : m.value,
        label: m.label
    }))
    return withCurrentModelOption(options, currentModel)
}

function getNextGeminiModel(currentModel?: string | null): string | null {
    const options = getGeminiModelOptions(currentModel)
    const currentIndex = options.findIndex((o) => o.value === (currentModel ?? null))
    if (currentIndex === -1) {
        return options[0]?.value ?? null
    }
    return options[(currentIndex + 1) % options.length]?.value ?? null
}

export function getModelOptionsForFlavor(
    flavor: string | undefined | null,
    currentModel?: string | null,
    customOptions?: ModelOption[]
): ModelOption[] {
    if (customOptions && customOptions.length > 0) {
        return withCurrentModelOption(customOptions, currentModel)
    }
    if (flavor === 'gemini') {
        return getGeminiModelOptions(currentModel)
    }
    // Codex/OpenCode/Pi discover models dynamically via RPC. Until those
    // options arrive, avoid falling through to Claude presets; show only the
    // current persisted model when one exists. Pi's real model list is
    // provided separately via the piModels prop (SessionChat -> HappyComposer
    // -> PiModelPanel), not through this function.
    if (flavor === 'codex' || flavor === 'opencode' || flavor === 'kimi' || flavor === 'grok' || flavor === 'pi') {
        return withCurrentModelOption([], currentModel)
    }
    return getClaudeComposerModelOptions(currentModel)
}

export function getNextModelForFlavor(
    flavor: string | undefined | null,
    currentModel?: string | null,
    customOptions?: ModelOption[]
): string | null {
    if (customOptions && customOptions.length > 0) {
        const options = getModelOptionsForFlavor(flavor, currentModel, customOptions)
        const currentIndex = options.findIndex((option) => option.value === (normalizeCurrentModel(currentModel) ?? null))
        if (currentIndex === -1) {
            return options.find((option) => option.value !== null)?.value ?? null
        }
        return options[(currentIndex + 1) % options.length]?.value ?? null
    }
    if (flavor === 'gemini') {
        return getNextGeminiModel(currentModel)
    }
    // Codex/OpenCode/Pi discover models dynamically via RPC. Until those
    // options arrive, pressing Ctrl/Cmd+M must not fall through to the Claude
    // preset cycler — that would post a Claude model into a non-Claude
    // session. Keep the current model unchanged instead. (Pi additionally
    // short-circuits this shortcut entirely in HappyComposer since its model
    // changes require a provider, which this generic cycler cannot supply.)
    if (flavor === 'codex' || flavor === 'opencode' || flavor === 'kimi' || flavor === 'grok' || flavor === 'pi') {
        return normalizeCurrentModel(currentModel)
    }
    return getNextClaudeComposerModel(currentModel)
}
