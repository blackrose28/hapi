import { describe, expect, it } from 'bun:test'
import { createSharedAuthRoutes } from './sharedAuth'

const verified = { issuer: 'https://id.example.com', subject: 's1', email: 'user@example.com', emailVerified: true as const }

function setup(overrides: {
    bootstrap?: boolean
    claim?: boolean
    validate?: boolean
} = {}) {
    const calls = { claimedToken: '', revokedToken: '', loginInvitation: '' }
    const app = createSharedAuthRoutes({
        organizationId: 'o1', bootstrapAdminEmail: 'admin@example.com',
        callbackUrl: 'https://hub.example.com/api/auth/callback', appUrl: 'https://hub.example.com/',
        oidc: {
            startLogin: async (_redirect: string, _now?: number, invitation?: string) => {
                calls.loginInvitation = invitation ?? ''
                return { authorizationUrl: 'https://id.example.com/authorize?state=state', state: 'state' }
            },
            completeLogin: async () => ({ identity: verified, invitationTokenHash: 'invite-hash' })
        } as never,
        identity: {
            completeBrowserLogin: (input: { invitationTokenHash: string | null }) => {
                calls.claimedToken = input.invitationTokenHash ?? ''
                return overrides.claim === false && !overrides.bootstrap
                    ? null
                    : { sessionToken: 'session-secret', csrfToken: 'csrf-secret', expiresAt: Date.now() + 60_000 }
            },
            validateSession: () => overrides.validate === false ? null : { membershipId: 'u1', organizationId: 'o1', role: 'member', csrfHash: 'hash' },
            revokeSession: (token: string) => { calls.revokedToken = token; return true }
        } as never
    })
    return { app, calls }
}

describe('Shared Hub auth routes', () => {
    it('starts ordinary login with no-store and no invitation bearer', async () => {
        const { app } = setup()
        const response = await app.request('/auth/login')
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toStartWith('https://id.example.com/authorize')
        const cookie = response.headers.get('set-cookie') ?? ''
        expect(cookie).not.toContain('invitation')
        expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('binds an invitation supplied in the POST body without reflecting it into URLs or cookies', async () => {
        const { app, calls } = setup()
        const invitationToken = 'invitation-secret-value'
        const response = await app.request('/auth/login', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invitationToken })
        })
        expect(response.status).toBe(200)
        expect(calls.loginInvitation).toBe(invitationToken)
        const body = await response.json()
        expect(body).toEqual({ authorizationUrl: 'https://id.example.com/authorize?state=state' })
        expect(JSON.stringify(body)).not.toContain(invitationToken)
        expect(response.headers.get('set-cookie') ?? '').not.toContain(invitationToken)
    })

    it('claims invitation and issues secure session/CSRF cookies on callback', async () => {
        const { app, calls } = setup()
        const response = await app.request('/auth/callback?state=state&code=code', {
            headers: {}
        })
        expect(response.status).toBe(302)
        expect(calls.claimedToken).toBe('invite-hash')
        const cookie = response.headers.get('set-cookie') ?? ''
        expect(cookie).toContain('__Host-hapi_session=session-secret')
        expect(cookie).toContain('__Host-hapi_csrf=csrf-secret')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('SameSite=Strict')
        expect(cookie).toContain('Secure')
    })

    it('allows configured bootstrap Admin but rejects public signup', async () => {
        expect((await setup({ bootstrap: true, claim: false }).app.request('/auth/callback?state=s&code=c')).status).toBe(302)
        expect((await setup({ bootstrap: false, claim: false }).app.request('/auth/callback?state=s&code=c')).status).toBe(403)
    })

    it('returns session context and requires CSRF for logout', async () => {
        const { app, calls } = setup()
        const cookie = '__Host-hapi_session=session-secret'
        const session = await app.request('/auth/session', { headers: { cookie } })
        expect(await session.json()).toEqual({ membershipId: 'u1', organizationId: 'o1', role: 'member' })
        expect((await app.request('/auth/logout', { method: 'POST', headers: { cookie } })).status).toBe(403)
        const logout = await app.request('/auth/logout', {
            method: 'POST', headers: { cookie, 'x-csrf-token': 'csrf-secret' }
        })
        expect(logout.status).toBe(204)
        expect(calls.revokedToken).toBe('session-secret')
    })
})
