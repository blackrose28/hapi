import React, { useMemo, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { ResumableSession } from '@hapi/protocol'
import {
    filterResumeSessions,
    formatResumeSessionRelativeTime,
    getResumeSessionName,
    getResumeSessionState,
    normalizeScrollOffset,
    reducePickerState,
    type PickerState
} from './resumeSessionPickerState'

type ExtendedKey = {
    upArrow?: boolean
    downArrow?: boolean
    return?: boolean
    escape?: boolean
    backspace?: boolean
    delete?: boolean
    ctrl?: boolean
    pageUp?: boolean
    pageDown?: boolean
    home?: boolean
    end?: boolean
    name?: string
    sequence?: string
}

export type ResumeSessionPickerProps = {
    sessions: ResumableSession[]
    onSelect: (sessionId: string) => void
    onCancel: () => void
}

function truncateText(value: string, maxLength: number): string {
    if (maxLength <= 0) return ''
    if (value.length <= maxLength) return value
    if (maxLength <= 3) return '.'.repeat(maxLength)
    return `${value.slice(0, maxLength - 3)}...`
}

function formatSessionLine(session: ResumableSession, width: number): string {
    const state = getResumeSessionState(session)
    const time = formatResumeSessionRelativeTime(session.updatedAt).padStart(10)
    const prefix = `${time}  ${session.flavor.padEnd(8)} ${state.padEnd(8)} `
    const directoryBudget = Math.max(16, Math.floor(width * 0.35))
    const nameBudget = Math.max(12, width - prefix.length - directoryBudget - 2)
    const name = truncateText(getResumeSessionName(session), nameBudget)
    const directory = truncateText(session.directory, directoryBudget)
    return `${prefix}${name.padEnd(nameBudget)}  ${directory}`
}

function isPrintableInput(input: string, key: ExtendedKey): boolean {
    if (key.ctrl || key.return || key.escape || key.backspace || key.delete) return false
    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown || key.home || key.end) return false
    if (input.length !== 1) return false
    return input >= ' ' && input !== '\u007f'
}

export const ResumeSessionPicker: React.FC<ResumeSessionPickerProps> = ({
    sessions,
    onSelect,
    onCancel
}) => {
    const { stdout } = useStdout()
    const terminalWidth = stdout.columns || 80
    const terminalHeight = stdout.rows || 24
    const visibleCount = Math.max(5, terminalHeight - 8)
    const [state, setState] = useState<PickerState>({
        query: '',
        selectedIndex: 0,
        scrollOffset: 0
    })

    const filteredSessions = useMemo(
        () => filterResumeSessions(sessions, state.query),
        [sessions, state.query]
    )
    const selectedIndex = filteredSessions.length === 0
        ? 0
        : Math.min(state.selectedIndex, filteredSessions.length - 1)
    const scrollOffset = normalizeScrollOffset(
        selectedIndex,
        state.scrollOffset,
        visibleCount,
        filteredSessions.length
    )
    const visibleSessions = filteredSessions.slice(scrollOffset, scrollOffset + visibleCount)

    useInput((input, key: ExtendedKey) => {
        if (key.ctrl && input === 'c') {
            onCancel()
            return
        }

        if (key.return) {
            const selected = filteredSessions[selectedIndex]
            if (selected) {
                onSelect(selected.sessionId)
            }
            return
        }

        if (key.escape) {
            if (state.query.length === 0) {
                onCancel()
                return
            }
            setState((current) => reducePickerState(current, {
                type: 'key',
                key: 'escape'
            }, {
                itemCount: filteredSessions.length,
                visibleCount
            }))
            return
        }

        const keyName = key.name
        const mappedKey =
            key.upArrow || keyName === 'up' ? 'up'
                : key.downArrow || keyName === 'down' ? 'down'
                    : key.pageUp || keyName === 'pageup' ? 'pageUp'
                        : key.pageDown || keyName === 'pagedown' ? 'pageDown'
                            : key.home || keyName === 'home' ? 'home'
                                : key.end || keyName === 'end' ? 'end'
                                    : key.backspace || key.delete || keyName === 'backspace' || keyName === 'delete' ? 'backspace'
                                        : null

        if (mappedKey) {
            setState((current) => reducePickerState(current, {
                type: 'key',
                key: mappedKey
            }, {
                itemCount: filteredSessions.length,
                visibleCount
            }))
            return
        }

        if (isPrintableInput(input, key)) {
            setState((current) => reducePickerState(current, {
                type: 'char',
                value: input
            }, {
                itemCount: filteredSessions.length,
                visibleCount
            }))
        }
    })

    const width = Math.max(40, terminalWidth - 4)
    const shownStart = filteredSessions.length === 0 ? 0 : scrollOffset + 1
    const shownEnd = Math.min(filteredSessions.length, scrollOffset + visibleSessions.length)

    return (
        <Box flexDirection="column" width={terminalWidth}>
            <Text bold>Resumable sessions</Text>
            <Text color="gray">
                Search: <Text color={state.query ? 'cyan' : 'gray'}>{state.query || 'type to filter'}</Text>
            </Text>
            <Text color="gray">
                {filteredSessions.length === 0
                    ? 'No matching sessions'
                    : `${shownStart}-${shownEnd} of ${filteredSessions.length}`}
            </Text>
            <Box flexDirection="column" marginTop={1}>
                {visibleSessions.map((session, index) => {
                    const absoluteIndex = scrollOffset + index
                    const selected = absoluteIndex === selectedIndex
                    return (
                        <Text
                            key={session.sessionId}
                            color={selected ? 'cyan' : undefined}
                            inverse={selected}
                        >
                            {selected ? '> ' : '  '}
                            {formatSessionLine(session, width - 2)}
                        </Text>
                    )
                })}
            </Box>
            <Box marginTop={1}>
                <Text color="gray">Up/Down move | PageUp/PageDown scroll | type search | Enter resume | Esc clear/cancel | Ctrl-C cancel</Text>
            </Box>
        </Box>
    )
}
