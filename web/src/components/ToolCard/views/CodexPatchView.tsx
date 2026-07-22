import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { basename, resolveDisplayPath } from '@/utils/path'
import { extractCodexPatchFiles } from '@/components/ToolCard/codexPatch'
import { useTranslation } from '@/lib/use-translation'

export function CodexPatchView(props: ToolViewProps) {
    const { t } = useTranslation()
    const files = extractCodexPatchFiles(props.block.tool.input)

    if (files.length === 0) {
        return (
            <div className="text-sm text-[var(--app-hint)]">
                {t('tool.patchDetailsUnavailable')}
            </div>
        )
    }

    const visible = props.surface === 'inline' ? files.slice(0, 3) : files
    const remaining = files.length - visible.length

    return (
        <div className="flex flex-col gap-1">
            {visible.map((file) => {
                const display = resolveDisplayPath(file.path, props.metadata)
                return (
                    <div
                        key={file.path}
                        title={file.path}
                        className={props.surface === 'inline'
                            ? 'truncate font-mono text-xs text-[var(--app-hint)]'
                            : 'text-sm text-[var(--app-fg)] font-mono break-all'}
                    >
                        {basename(display)}
                    </div>
                )
            })}
            {remaining > 0 ? (
                <div className="text-xs text-[var(--app-hint)]">
                    {t('tool.moreFiles', { count: remaining })}
                </div>
            ) : null}
        </div>
    )
}
