import { useCallback, useEffect, useState } from 'react'
import { ApiClient } from '@/api/client'

export type SessionInfo = {
    membershipId: string
    organizationId: string
    role: 'admin' | 'member' | 'viewer'
}

export function useAuth(baseUrl: string): {
    session: SessionInfo | null
    api: ApiClient | null
    isLoading: boolean
    error: string | null
    login: () => void
    loginWithInvitation: (token: string) => Promise<void>
    logout: () => Promise<void>
} {
    const [session, setSession] = useState<SessionInfo | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const checkSession = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const res = await fetch(`${baseUrl}/api/auth/session`, { credentials: 'include' })
            if (res.ok) {
                const data = (await res.json()) as SessionInfo
                setSession(data)
            } else {
                setSession(null)
            }
        } catch {
            setSession(null)
        } finally {
            setIsLoading(false)
        }
    }, [baseUrl])

    useEffect(() => {
        checkSession()
    }, [checkSession])

    const login = useCallback(() => {
        window.location.href = `${baseUrl}/api/auth/login`
    }, [baseUrl])

    const loginWithInvitation = useCallback(async (invitationToken: string) => {
        setIsLoading(true)
        setError(null)
        try {
            const res = await fetch(`${baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ invitationToken })
            })
            if (!res.ok) {
                const body = await res.text().catch(() => '')
                setError(body || 'Invalid invitation token.')
                setIsLoading(false)
                return
            }
            const data = (await res.json()) as { authorizationUrl: string }
            window.location.href = data.authorizationUrl
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Login failed')
            setIsLoading(false)
        }
    }, [baseUrl])

    const logout = useCallback(async () => {
        await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', credentials: 'include' })
        setSession(null)
    }, [baseUrl])

    const api = session ? new ApiClient({ baseUrl }) : null

    return { session, api, isLoading, error, login, loginWithInvitation, logout }
}
