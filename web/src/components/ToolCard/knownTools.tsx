import type { ReactNode } from 'react'
import type { SessionMetadataSummary } from '@/types/api'
import { isObject } from '@hapi/protocol'
import { BulbIcon, ClipboardIcon, EyeIcon, FileDiffIcon, GlobeIcon, MessageSquareIcon, PuzzleIcon, QuestionIcon, RocketIcon, SearchIcon, TerminalIcon, UsersIcon, WrenchIcon } from '@/components/ToolCard/icons'
import type { ChecklistItem } from '@/components/ToolCard/checklist'
import { extractTodoChecklist, extractUpdatePlanChecklist } from '@/components/ToolCard/checklist'
import { basename, resolveDisplayPath } from '@/utils/path'
import { getInputStringAny, truncate } from '@/lib/toolInputUtils'
import { extractCodexPatchFiles } from '@/components/ToolCard/codexPatch'

const DEFAULT_ICON_CLASS = 'h-3.5 w-3.5'
// Tool presentation registry for `hapi/web` (aligned with `hapi-app`).

export type ToolPresentation = {
    icon: ReactNode
    title: string
    subtitle: string | null
    minimal: boolean
    tone: ToolSurfaceTone
}

export type ToolSurfaceTone = 'neutral' | 'plan' | 'diff'

const PLAN_TOOLS = new Set(['update_plan', 'TodoWrite', 'ExitPlanMode', 'exit_plan_mode'])
const DIFF_TOOLS = new Set(['CodexDiff', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

function getToolSurfaceTone(toolName: string): ToolSurfaceTone {
    if (PLAN_TOOLS.has(toolName)) return 'plan'
    if (DIFF_TOOLS.has(toolName)) return 'diff'
    return 'neutral'
}

function countLines(text: string): number {
    return text.split('\n').length
}

type ToolTranslate = (
    key: string,
    params?: Record<string, string | number>
) => string

function toolText(
    opts: ToolOpts,
    key: string,
    fallback: string,
    params?: Record<string, string | number>
): string {
    const translated = opts.t?.(key, params)
    return translated && translated !== key ? translated : fallback
}

function formatChecklistCount(
    opts: ToolOpts,
    items: ChecklistItem[],
    noun: 'item' | 'step'
): string | null {
    if (items.length === 0) return null
    const fallback = `${items.length} ${noun}${items.length === 1 ? '' : 's'}`
    const key = items.length === 1 ? noun : `${noun}s`
    return toolText(opts, `tool.count.${key}`, fallback, { count: items.length })
}

function snakeToTitleWithSpaces(value: string): string {
    return value
        .split('_')
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
}

function formatMCPTitle(toolName: string): string {
    const withoutPrefix = toolName.replace(/^mcp__/, '')
    const parts = withoutPrefix.split('__')
    if (parts.length >= 2) {
        const serverName = snakeToTitleWithSpaces(parts[0])
        const toolPart = snakeToTitleWithSpaces(parts.slice(1).join('_'))
        return `MCP: ${serverName} ${toolPart}`
    }
    return `MCP: ${snakeToTitleWithSpaces(withoutPrefix)}`
}

type ToolOpts = {
    toolName: string
    input: unknown
    result: unknown
    childrenCount: number
    description: string | null
    metadata: SessionMetadataSummary | null
    t?: ToolTranslate
}

export const knownTools: Record<string, {
    icon: (opts: ToolOpts) => ReactNode
    title: (opts: ToolOpts) => string
    subtitle?: (opts: ToolOpts) => string | null
    minimal?: boolean | ((opts: ToolOpts) => boolean)
}> = {
    Task: {
        icon: () => <RocketIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const name = getInputStringAny(opts.input, ['name'])
            const teamName = getInputStringAny(opts.input, ['team_name'])
            if (name && teamName) return `Agent: ${name}`
            const description = getInputStringAny(opts.input, ['description'])
            return description ?? toolText(opts, 'tool.title.task', 'Task')
        },
        subtitle: (opts) => {
            const prompt = getInputStringAny(opts.input, ['prompt'])
            return prompt ? truncate(prompt, 120) : null
        },
        minimal: (opts) => opts.childrenCount === 0
    },
    TeamCreate: {
        icon: () => <UsersIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const teamName = getInputStringAny(opts.input, ['team_name'])
            return teamName
                ? toolText(opts, 'tool.title.team', `Team: ${teamName}`, { name: teamName })
                : toolText(opts, 'tool.title.createTeam', 'Create Team')
        },
        subtitle: (opts) => getInputStringAny(opts.input, ['description']) ?? null,
        minimal: false
    },
    TeamDelete: {
        icon: () => <UsersIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => toolText(opts, 'tool.title.deleteTeam', 'Delete Team'),
        minimal: true
    },
    SendMessage: {
        icon: () => <MessageSquareIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const recipient = getInputStringAny(opts.input, ['recipient'])
            const msgType = getInputStringAny(opts.input, ['type'])
            if (msgType === 'broadcast') return toolText(opts, 'tool.title.broadcast', 'Broadcast')
            if (msgType === 'shutdown_request') {
                const target = recipient ?? 'agent'
                return toolText(opts, 'tool.title.shutdown', `Shutdown: ${target}`, { target })
            }
            if (msgType === 'shutdown_response') {
                return toolText(opts, 'tool.title.shutdownResponse', 'Shutdown Response')
            }
            return recipient
                ? toolText(opts, 'tool.title.message', `Message: ${recipient}`, { recipient })
                : toolText(opts, 'tool.title.sendMessage', 'Send Message')
        },
        subtitle: (opts) => {
            const summary = getInputStringAny(opts.input, ['summary'])
            return summary ? truncate(summary, 120) : null
        },
        minimal: true
    },
    Bash: {
        icon: () => <TerminalIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => opts.description ?? toolText(opts, 'tool.title.terminal', 'Terminal'),
        subtitle: (opts) => getInputStringAny(opts.input, ['command', 'cmd']),
        minimal: true
    },
    Glob: {
        icon: () => <SearchIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => getInputStringAny(opts.input, ['pattern'])
            ?? toolText(opts, 'tool.title.searchFiles', 'Search files'),
        minimal: true
    },
    Grep: {
        icon: () => <EyeIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const pattern = getInputStringAny(opts.input, ['pattern'])
            return pattern
                ? `grep(pattern: ${pattern})`
                : toolText(opts, 'tool.title.searchContent', 'Search content')
        },
        minimal: true
    },
    LS: {
        icon: () => <SearchIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['path'])
            return path
                ? resolveDisplayPath(path, opts.metadata)
                : toolText(opts, 'tool.title.listFiles', 'List files')
        },
        minimal: true
    },
    CodexBash: {
        icon: (opts) => {
            if (isObject(opts.input) && Array.isArray(opts.input.parsed_cmd) && opts.input.parsed_cmd.length > 0) {
                const first = opts.input.parsed_cmd[0]
                const type = isObject(first) ? first.type : null
                if (type === 'read') return <EyeIcon className={DEFAULT_ICON_CLASS} />
                if (type === 'write') return <FileDiffIcon className={DEFAULT_ICON_CLASS} />
            }
            return <TerminalIcon className={DEFAULT_ICON_CLASS} />
        },
        title: (opts) => {
            if (isObject(opts.input) && Array.isArray(opts.input.parsed_cmd) && opts.input.parsed_cmd.length === 1) {
                const parsed = opts.input.parsed_cmd[0]
                if (isObject(parsed) && parsed.type === 'read' && typeof parsed.name === 'string') {
                    return resolveDisplayPath(parsed.name, opts.metadata)
                }
            }
            return opts.description ?? toolText(opts, 'tool.title.terminal', 'Terminal')
        },
        subtitle: (opts) => {
            const command = getInputStringAny(opts.input, ['command', 'cmd'])
            if (command) return command
            if (isObject(opts.input) && Array.isArray(opts.input.command)) {
                return opts.input.command.filter((part) => typeof part === 'string').join(' ')
            }
            return null
        },
        minimal: (opts) => {
            const result = isObject(opts.result) ? opts.result : null
            const stdout = result && typeof result.stdout === 'string' ? result.stdout.trim() : ''
            const stderr = result && typeof result.stderr === 'string' ? result.stderr.trim() : ''
            return stdout.length === 0 && stderr.length === 0
        }
    },
    CodexPermission: {
        icon: () => <QuestionIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const tool = getInputStringAny(opts.input, ['tool'])
            return tool
                ? toolText(opts, 'tool.title.permission', `Permission: ${tool}`, { tool })
                : toolText(opts, 'tool.title.permissionRequest', 'Permission request')
        },
        subtitle: (opts) => getInputStringAny(opts.input, ['message', 'command']) ?? null,
        minimal: true
    },
    shell_command: {
        icon: () => <TerminalIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => opts.description ?? toolText(opts, 'tool.title.terminal', 'Terminal'),
        subtitle: (opts) => getInputStringAny(opts.input, ['command', 'cmd']),
        minimal: true
    },
    Read: {
        icon: () => <EyeIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path', 'file'])
            return file
                ? resolveDisplayPath(file, opts.metadata)
                : toolText(opts, 'tool.title.readFile', 'Read file')
        },
        minimal: true
    },
    Edit: {
        icon: () => <FileDiffIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            return file
                ? resolveDisplayPath(file, opts.metadata)
                : toolText(opts, 'tool.title.editFile', 'Edit file')
        },
        minimal: true
    },
    MultiEdit: {
        icon: () => <FileDiffIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            if (!file) return toolText(opts, 'tool.title.editFile', 'Edit file')
            const edits = isObject(opts.input) && Array.isArray(opts.input.edits) ? opts.input.edits : null
            const count = edits ? edits.length : 0
            const path = resolveDisplayPath(file, opts.metadata)
            return count > 1
                ? toolText(opts, 'tool.count.edits', `${path} (${count} edits)`, { path, count })
                : path
        },
        minimal: true
    },
    Write: {
        icon: () => <FileDiffIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            return file
                ? resolveDisplayPath(file, opts.metadata)
                : toolText(opts, 'tool.title.writeFile', 'Write file')
        },
        subtitle: (opts) => {
            const content = getInputStringAny(opts.input, ['content', 'text'])
            if (!content) return null
            const lines = countLines(content)
            return lines > 1
                ? toolText(opts, 'tool.count.lines', `${lines} lines`, { count: lines })
                : toolText(opts, 'tool.count.chars', `${content.length} chars`, { count: content.length })
        },
        minimal: true
    },
    WebFetch: {
        icon: () => <GlobeIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const url = getInputStringAny(opts.input, ['url'])
            if (!url) return toolText(opts, 'tool.title.webFetch', 'Web fetch')
            try {
                return new URL(url).hostname
            } catch {
                return url
            }
        },
        subtitle: (opts) => {
            const url = getInputStringAny(opts.input, ['url'])
            if (!url) return null
            return url
        },
        minimal: true
    },
    WebSearch: {
        icon: () => <GlobeIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => getInputStringAny(opts.input, ['query'])
            ?? toolText(opts, 'tool.title.webSearch', 'Web search'),
        subtitle: (opts) => {
            const query = getInputStringAny(opts.input, ['query'])
            return query ? truncate(query, 80) : null
        },
        minimal: true
    },
    NotebookRead: {
        icon: () => <EyeIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['notebook_path'])
            return path
                ? resolveDisplayPath(path, opts.metadata)
                : toolText(opts, 'tool.title.readNotebook', 'Read notebook')
        },
        minimal: true
    },
    NotebookEdit: {
        icon: () => <FileDiffIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['notebook_path'])
            return path
                ? resolveDisplayPath(path, opts.metadata)
                : toolText(opts, 'tool.title.editNotebook', 'Edit notebook')
        },
        subtitle: (opts) => {
            const mode = getInputStringAny(opts.input, ['edit_mode'])
            return mode
                ? toolText(opts, 'tool.subtitle.mode', `mode: ${mode}`, { mode })
                : null
        },
        minimal: false
    },
    TodoWrite: {
        icon: () => <BulbIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => toolText(opts, 'tool.title.todoList', 'Todo list'),
        subtitle: (opts) => formatChecklistCount(opts, extractTodoChecklist(opts.input, opts.result), 'item'),
        minimal: (opts) => extractTodoChecklist(opts.input, opts.result).length === 0
    },
    update_plan: {
        icon: () => <ClipboardIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => toolText(opts, 'tool.title.plan', 'Plan'),
        subtitle: (opts) => formatChecklistCount(opts, extractUpdatePlanChecklist(opts.input, opts.result), 'step'),
        minimal: (opts) => extractUpdatePlanChecklist(opts.input, opts.result).length === 0
    },
    Skill: {
        icon: () => <PuzzleIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const skill = getInputStringAny(opts.input, ['skill'])
            return skill
                ? toolText(opts, 'tool.title.skillNamed', `Skill: ${skill}`, { skill })
                : toolText(opts, 'tool.title.skill', 'Skill')
        },
        minimal: true
    },
    Agent: {
        icon: () => <RocketIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const description = getInputStringAny(opts.input, ['description'])
            return description ?? toolText(opts, 'tool.title.agent', 'Agent')
        },
        subtitle: (opts) => {
            const model = getInputStringAny(opts.input, ['subagent_type'])
            return model ?? null
        },
        minimal: true
    },
    CodexReasoning: {
        icon: () => <BulbIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => getInputStringAny(opts.input, ['title'])
            ?? toolText(opts, 'tool.title.reasoning', 'Reasoning'),
        minimal: true
    },
    CodexPatch: {
        icon: () => <FileDiffIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => toolText(opts, 'tool.title.applyChanges', 'Apply changes'),
        subtitle: (opts) => {
            const files = extractCodexPatchFiles(opts.input)
            if (files.length === 0) return ''
            const display = resolveDisplayPath(files[0].path, opts.metadata)
            const name = basename(display)
            return files.length > 1 ? `${name} (+${files.length - 1})` : name
        },
        minimal: true
    },
    CodexDiff: {
        icon: () => <FileDiffIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => toolText(opts, 'tool.title.diff', 'Diff'),
        subtitle: (opts) => {
            const unified = getInputStringAny(opts.input, ['unified_diff'])
            if (!unified) return null
            const lines = unified.split('\n')
            for (const line of lines) {
                if (line.startsWith('+++ b/') || line.startsWith('+++ ')) {
                    const fileName = line.replace(/^\+\+\+ (b\/)?/, '')
                    return fileName.split('/').pop() ?? fileName
                }
            }
            return null
        },
        minimal: (opts) => {
            const unified = getInputStringAny(opts.input, ['unified_diff'])
            return !unified
        }
    },
    ExitPlanMode: {
        icon: () => <ClipboardIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => toolText(opts, 'tool.title.planProposal', 'Plan proposal'),
        minimal: false
    },
    exit_plan_mode: {
        icon: () => <ClipboardIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => toolText(opts, 'tool.title.planProposal', 'Plan proposal'),
        minimal: false
    },
    AskUserQuestion: {
        icon: () => <QuestionIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
                ? opts.input.questions : []
            const count = questions.length
            const first = questions[0] ?? null
            const header = isObject(first) && typeof first.header === 'string'
                ? first.header.trim() : ''

            if (count > 1) {
                return toolText(opts, 'tool.title.questions', `${count} Questions`, { count })
            }
            return header.length > 0
                ? header
                : toolText(opts, 'tool.title.question', 'Question')
        },
        subtitle: (opts) => {
            const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
                ? opts.input.questions : []
            const count = questions.length
            const first = questions[0] ?? null
            const question = isObject(first) && typeof first.question === 'string'
                ? first.question.trim() : ''

            if (count > 1 && question.length > 0) {
                const remaining = count - 1
                return truncate(question, 100) + ' ' + toolText(
                    opts,
                    'tool.count.moreQuestions',
                    `(+${remaining} more)`,
                    { count: remaining }
                )
            }
            return question.length > 0 ? truncate(question, 120) : null
        },
        minimal: true
    },
    ask_user_question: {
        icon: () => <QuestionIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
                ? opts.input.questions : []
            const count = questions.length
            const first = questions[0] ?? null
            const header = isObject(first) && typeof first.header === 'string'
                ? first.header.trim() : ''

            if (count > 1) {
                return toolText(opts, 'tool.title.questions', `${count} Questions`, { count })
            }
            return header.length > 0
                ? header
                : toolText(opts, 'tool.title.question', 'Question')
        },
        subtitle: (opts) => {
            const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
                ? opts.input.questions : []
            const count = questions.length
            const first = questions[0] ?? null
            const question = isObject(first) && typeof first.question === 'string'
                ? first.question.trim() : ''

            if (count > 1 && question.length > 0) {
                const remaining = count - 1
                return truncate(question, 100) + ' ' + toolText(
                    opts,
                    'tool.count.moreQuestions',
                    `(+${remaining} more)`,
                    { count: remaining }
                )
            }
            return question.length > 0 ? truncate(question, 120) : null
        },
        minimal: true
    },
    request_user_input: {
        icon: () => <QuestionIcon className={DEFAULT_ICON_CLASS} />,
        title: (opts) => {
            const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
                ? opts.input.questions : []
            const count = questions.length
            const first = questions[0] ?? null
            const id = isObject(first) && typeof first.id === 'string'
                ? first.id.trim() : ''

            if (count > 1) {
                return toolText(opts, 'tool.title.questions', `${count} Questions`, { count })
            }
            return id.length > 0
                ? id
                : toolText(opts, 'tool.title.question', 'Question')
        },
        subtitle: (opts) => {
            const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
                ? opts.input.questions : []
            const count = questions.length
            const first = questions[0] ?? null
            const question = isObject(first) && typeof first.question === 'string'
                ? first.question.trim() : ''

            if (count > 1 && question.length > 0) {
                const remaining = count - 1
                return truncate(question, 100) + ' ' + toolText(
                    opts,
                    'tool.count.moreQuestions',
                    `(+${remaining} more)`,
                    { count: remaining }
                )
            }
            return question.length > 0 ? truncate(question, 120) : null
        },
        minimal: true
    }
}

export function getToolPresentation(opts: ToolOpts): ToolPresentation {
    if (opts.toolName.startsWith('mcp__')) {
        return {
            icon: <PuzzleIcon className={DEFAULT_ICON_CLASS} />,
            title: formatMCPTitle(opts.toolName),
            subtitle: null,
            minimal: true,
            tone: getToolSurfaceTone(opts.toolName)
        }
    }

    const known = knownTools[opts.toolName]
    if (known) {
        const minimal = typeof known.minimal === 'function' ? known.minimal(opts) : (known.minimal ?? false)
        return {
            icon: known.icon(opts),
            title: known.title(opts),
            subtitle: known.subtitle ? known.subtitle(opts) : null,
            minimal,
            tone: getToolSurfaceTone(opts.toolName)
        }
    }

    const filePath = getInputStringAny(opts.input, ['file_path', 'path', 'filePath', 'file'])
    const command = getInputStringAny(opts.input, ['command', 'cmd'])
    const pattern = getInputStringAny(opts.input, ['pattern'])
    const url = getInputStringAny(opts.input, ['url'])
    const query = getInputStringAny(opts.input, ['query'])

    const subtitle = filePath ?? command ?? pattern ?? url ?? query

    return {
        icon: <WrenchIcon className={DEFAULT_ICON_CLASS} />,
        title: opts.toolName,
        subtitle: subtitle ? truncate(subtitle, 80) : null,
        minimal: true,
        tone: getToolSurfaceTone(opts.toolName)
    }
}
