import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from './client'

describe('ApiClient sendMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        Reflect.deleteProperty(globalThis, 'document')
    })

    it('includes credentials and the CSRF token for message mutations', async () => {
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { cookie: '__Host-hapi_csrf=csrf-token' }
        })
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ ok: true, sessionId: 'session-1' })
        } as Response)
        const api = new ApiClient()

        await expect(api.sendMessage('session-1', 'hello', 'local-1')).resolves.toEqual({
            status: 'sent',
            sessionId: 'session-1'
        })

        expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
            method: 'POST',
            credentials: 'include',
            headers: expect.any(Headers)
        }))
        const init = fetchMock.mock.calls[0]?.[1]
        expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-token')
    })
})
