import { expect, it } from 'vitest'

const sources = import.meta.glob('/src/**/*.tsx', {
    eager: true,
    import: 'default',
    query: '?raw'
}) as Record<string, string>

it('keeps raw DialogContent imports inside the ui layer only', () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) => {
        if (file.endsWith('ui/dialog.tsx') || file.endsWith('ui/app-dialog.tsx')) {
            return []
        }
        return source.includes("from '@/components/ui/dialog'") && source.includes('DialogContent')
            ? [file]
            : []
    })

    expect(offenders).toEqual([])
})

it('keeps custom modal dialog markup out of feature components', () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) => {
        if (file.endsWith('.test.tsx')) {
            return []
        }
        return source.includes('role="dialog"') || source.includes("role='dialog'")
            ? [file]
            : []
    })

    expect(offenders).toEqual([])
})

it('keeps full-screen modal overlays inside AppDialog', () => {
    const allowedOverlays = new Set([
        '/src/components/editor/EditorContextMenu.tsx',
        '/src/components/ui/dialog.tsx',
    ])
    const offenders = Object.entries(sources).flatMap(([file, source]) => {
        if (allowedOverlays.has(file) || file.endsWith('.test.tsx')) {
            return []
        }
        return source.includes('fixed inset-0') ? [file] : []
    })

    expect(offenders).toEqual([])
})

it('classifies application-level mobile dialog presentations', () => {
    const expectedPresentations = {
        '/src/components/modals/BrowserModal.tsx': 'workspace',
        '/src/components/modals/FilesModal.tsx': 'workspace',
        '/src/components/modals/SettingsModal.tsx': 'workspace',
        '/src/components/modals/NewSessionModal.tsx': 'workspace',
        '/src/components/modals/ReplacePinModal.tsx': 'sheet',
        '/src/components/TeamChat/TeamSessionChatModal.tsx': 'workspace',
        '/src/components/SessionGoalControl.tsx': 'sheet',
    } as const

    for (const [file, presentation] of Object.entries(expectedPresentations)) {
        expect(sources[file], file).toContain(`presentation="${presentation}"`)
    }
})

it('requires every feature AppDialogContent to declare a presentation', () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) => {
        if (file.endsWith('ui/app-dialog.tsx') || file.endsWith('.test.tsx')) {
            return []
        }

        const openings = source.match(/<AppDialogContent\b[\s\S]*?>/g) ?? []
        return openings.some((opening) => !/\bpresentation=/.test(opening))
            ? [file]
            : []
    })

    expect(offenders).toEqual([])
})

it('keeps mobile dialog positioning inside the shared component', () => {
    const featurePositioning = /\b(?:bottom-0|top-auto|h-\[100dvh\]|translate-y-0|rounded-b-none|rounded-t-(?:xl|2xl))\b/
    const offenders = Object.entries(sources).flatMap(([file, source]) => {
        if (file.endsWith('ui/app-dialog.tsx') || file.endsWith('.test.tsx')) {
            return []
        }

        const openings = source.match(/<AppDialogContent\b[\s\S]*?>/g) ?? []
        return openings.some((opening) => featurePositioning.test(opening))
            ? [file]
            : []
    })

    expect(offenders).toEqual([])
})
