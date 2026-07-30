export type TerminalSnippetCatalogGroup = 'navigation' | 'git' | 'system'

export type TerminalSnippetCatalogItem = {
    id: string
    group: TerminalSnippetCatalogGroup
    nameKey: string
    descriptionKey: string
    command: string
}

export const TERMINAL_SNIPPET_CATALOG = [
    {
        id: 'builtin-pwd',
        group: 'navigation',
        nameKey: 'terminal.snippets.builtin.pwd.name',
        descriptionKey: 'terminal.snippets.builtin.pwd.description',
        command: 'pwd',
    },
    {
        id: 'builtin-list',
        group: 'navigation',
        nameKey: 'terminal.snippets.builtin.list.name',
        descriptionKey: 'terminal.snippets.builtin.list.description',
        command: 'ls -la',
    },
    {
        id: 'builtin-clear',
        group: 'navigation',
        nameKey: 'terminal.snippets.builtin.clear.name',
        descriptionKey: 'terminal.snippets.builtin.clear.description',
        command: 'clear',
    },
    {
        id: 'builtin-git-status',
        group: 'git',
        nameKey: 'terminal.snippets.builtin.gitStatus.name',
        descriptionKey: 'terminal.snippets.builtin.gitStatus.description',
        command: 'git status --short',
    },
    {
        id: 'builtin-git-diff',
        group: 'git',
        nameKey: 'terminal.snippets.builtin.gitDiff.name',
        descriptionKey: 'terminal.snippets.builtin.gitDiff.description',
        command: 'git diff',
    },
    {
        id: 'builtin-git-log',
        group: 'git',
        nameKey: 'terminal.snippets.builtin.gitLog.name',
        descriptionKey: 'terminal.snippets.builtin.gitLog.description',
        command: 'git log --oneline -10',
    },
    {
        id: 'builtin-processes',
        group: 'system',
        nameKey: 'terminal.snippets.builtin.processes.name',
        descriptionKey: 'terminal.snippets.builtin.processes.description',
        command: 'ps aux',
    },
    {
        id: 'builtin-disk',
        group: 'system',
        nameKey: 'terminal.snippets.builtin.disk.name',
        descriptionKey: 'terminal.snippets.builtin.disk.description',
        command: 'df -h',
    },
] as const satisfies readonly TerminalSnippetCatalogItem[]
