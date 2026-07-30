import { describe, expect, it } from 'bun:test'
import { TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE } from '@hapi/protocol'

import { Store } from './index'

describe('TerminalSnippetStore', () => {
    it('isolates list, update, and delete operations by namespace', () => {
        const store = new Store(':memory:')
        const snippetA = store.terminalSnippets.create({
            namespace: 'ns-a',
            name: 'List files',
            command: 'ls',
            description: null,
            now: 100
        })
        const snippetB = store.terminalSnippets.create({
            namespace: 'ns-b',
            name: 'Show directory',
            command: 'pwd',
            description: 'Print current directory',
            now: 200
        })

        expect(store.terminalSnippets.list('ns-a').map(snippet => snippet.id)).toEqual([snippetA.id])
        expect(store.terminalSnippets.list('ns-b').map(snippet => snippet.id)).toEqual([snippetB.id])

        expect(() => store.terminalSnippets.update({
            namespace: 'ns-b',
            id: snippetA.id,
            name: 'Changed',
            command: 'echo changed',
            description: null,
            now: 300
        })).toThrow('TERMINAL_SNIPPET_NOT_FOUND')
        expect(store.terminalSnippets.delete('ns-b', snippetA.id)).toBe(false)

        const unchanged = store.terminalSnippets.list('ns-a')[0]
        expect(unchanged.name).toBe('List files')
        expect(store.terminalSnippets.delete('ns-a', snippetA.id)).toBe(true)
        expect(store.terminalSnippets.list('ns-a')).toEqual([])
        expect(store.terminalSnippets.list('ns-b').map(snippet => snippet.id)).toEqual([snippetB.id])
    })

    it('keeps newest-created ordering stable after editing an older snippet', () => {
        const store = new Store(':memory:')
        const older = store.terminalSnippets.create({
            namespace: 'default',
            name: 'Older',
            command: 'echo older',
            description: null,
            now: 100
        })
        const newer = store.terminalSnippets.create({
            namespace: 'default',
            name: 'Newer',
            command: 'echo newer',
            description: null,
            now: 200
        })

        const updatedOlder = store.terminalSnippets.update({
            namespace: 'default',
            id: older.id,
            name: 'Older edited',
            command: 'echo edited',
            description: 'Edited',
            now: 300
        })

        expect(updatedOlder.createdAt).toBe(100)
        expect(updatedOlder.updatedAt).toBe(300)
        expect(store.terminalSnippets.list('default').map(snippet => snippet.id)).toEqual([
            newer.id,
            older.id
        ])
    })

    it('uses a deterministic id tie-breaker when snippets share created_at', () => {
        const store = new Store(':memory:')
        store.terminalSnippets.create({
            namespace: 'default',
            name: 'First',
            command: 'echo first',
            description: null,
            now: 100
        })
        store.terminalSnippets.create({
            namespace: 'default',
            name: 'Second',
            command: 'echo second',
            description: null,
            now: 100
        })

        const firstRead = store.terminalSnippets.list('default').map(snippet => snippet.id)
        const secondRead = store.terminalSnippets.list('default').map(snippet => snippet.id)

        expect(firstRead).toEqual([...firstRead].sort((a, b) => b.localeCompare(a)))
        expect(secondRead).toEqual(firstRead)
    })

    it('allows duplicate names in the same namespace', () => {
        const store = new Store(':memory:')
        store.terminalSnippets.create({
            namespace: 'default',
            name: 'Deploy',
            command: 'deploy staging',
            description: null
        })
        store.terminalSnippets.create({
            namespace: 'default',
            name: 'Deploy',
            command: 'deploy production',
            description: null
        })

        expect(store.terminalSnippets.list('default')).toHaveLength(2)
    })

    it('accepts 200 snippets per namespace, rejects the 201st, and leaves other namespaces independent', () => {
        const store = new Store(':memory:')
        for (let index = 0; index < TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE; index++) {
            store.terminalSnippets.create({
                namespace: 'ns-a',
                name: `Snippet ${index}`,
                command: `echo ${index}`,
                description: null,
                now: index
            })
        }

        expect(store.terminalSnippets.list('ns-a')).toHaveLength(TERMINAL_SNIPPETS_MAX_ITEMS_PER_NAMESPACE)
        expect(() => store.terminalSnippets.create({
            namespace: 'ns-a',
            name: 'One too many',
            command: 'echo rejected',
            description: null
        })).toThrow('TERMINAL_SNIPPET_LIMIT_REACHED')

        expect(store.terminalSnippets.create({
            namespace: 'ns-b',
            name: 'Independent quota',
            command: 'echo accepted',
            description: null
        }).namespace).toBe('ns-b')
    })

    it('throws not found when updating a missing snippet', () => {
        const store = new Store(':memory:')

        expect(() => store.terminalSnippets.update({
            namespace: 'default',
            id: 'missing',
            name: 'Missing',
            command: 'echo missing',
            description: null
        })).toThrow('TERMINAL_SNIPPET_NOT_FOUND')
    })
})
