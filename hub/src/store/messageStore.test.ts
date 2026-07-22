import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('message persistence result', () => {
    it('classifies inserted and duplicate local IDs while returning the persisted message', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('message-result', {}, null, 'default')

        const inserted = store.messages.addMessage(session.id, { value: 'first' }, 'local-1')
        const duplicate = store.messages.addMessage(session.id, { value: 'retry payload' }, 'local-1')

        expect(inserted.kind).toBe('inserted')
        expect(duplicate.kind).toBe('duplicate')
        expect(duplicate.message.id).toBe(inserted.message.id)
        expect(duplicate.message.content).toEqual({ value: 'first' })
        expect(store.messages.getMessages(session.id)).toHaveLength(1)
    })
})
