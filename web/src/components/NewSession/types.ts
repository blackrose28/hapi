import {
    CLAUDE_MODEL_PRESETS,
    GEMINI_MODEL_PRESETS,
    GEMINI_MODEL_LABELS,
    getClaudeModelLabel,
    type GrokPermissionMode,
    type AgentFlavor
} from '@hapi/protocol'

export type AgentType = AgentFlavor
export type SessionType = 'simple' | 'worktree'
// Codex reports supported efforts dynamically; keep this open for new server values.
export type CodexReasoningEffort = string
export type ReasoningEffort = CodexReasoningEffort | string
export type ClaudeEffort = 'auto' | 'medium' | 'high' | 'max'
// Grok reports effort values dynamically via ACP; keep this open like
// CodexReasoningEffort so newly-reported values don't need a type change.
export type GrokEffort = 'auto' | 'low' | 'medium' | 'high' | string
// Shared by the LaunchEffortSelector (Claude + Grok both use it).
export type LaunchEffort = ClaudeEffort | GrokEffort
export type NewSessionServiceTier = 'standard' | 'fast'

export type NewSessionDraft = {
    machineId: string | null
    directory: string
    agent: AgentType
    model: string
    effort: LaunchEffort
    modelReasoningEffort: ReasoningEffort
    yoloMode: boolean
    grokPermissionMode: GrokPermissionMode
    sessionType: SessionType
    worktreeName: string
    resumeCodex: boolean
    resumeCodexSessionId: string
    opencodeSelectedModel: string | null
}

export const MODEL_OPTIONS: Record<AgentType, { value: string; label: string }[]> = {
    claude: [
        { value: 'auto', label: 'Default' },
        ...CLAUDE_MODEL_PRESETS.map((model) => ({
            value: model,
            label: getClaudeModelLabel(model) ?? model
        }))
    ],
    codex: [
        { value: 'auto', label: 'Default' },
    ],
    cursor: [],
    kimi: [
        { value: 'auto', label: 'Default' },
    ],
    gemini: [
        { value: 'auto', label: 'Default' },
        ...GEMINI_MODEL_PRESETS.map((model) => ({ value: model, label: GEMINI_MODEL_LABELS[model] ?? model })),
    ],
    opencode: [],
    grok: [],
    pi: [],
}

export const CODEX_REASONING_EFFORT_OPTIONS: { value: CodexReasoningEffort; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'XHigh' },
]

export const CLAUDE_EFFORT_OPTIONS: { value: LaunchEffort; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' },
]

export const GROK_EFFORT_OPTIONS: { value: LaunchEffort; label: string }[] = [
    { value: 'auto', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
]
