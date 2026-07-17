import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '@/lib/app-context'
import { useServerUrl } from '@/hooks/useServerUrl'

type Enrollment = {
    id: string
    ownerMembershipId: string
    expiresAt: number
    consumed: boolean
    cancelled: boolean
    status: string
}

type Runner = {
    id: string
    ownerMembershipId: string
    machineId: string
    profile: string
    name: string
    status: string
    createdAt: number
}

export function RunnersPage() {
    const { api, role } = useAppContext()
    const isViewer = role === 'viewer'
    const { serverUrl } = useServerUrl()
    const [enrollments, setEnrollments] = useState<Enrollment[]>([])
    const [runners, setRunners] = useState<Runner[]>([])
    const [loading, setLoading] = useState(true)
    const [enrollmentCode, setEnrollmentCode] = useState<{ enrollmentId: string; code: string; expiresAt: number } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [showDialog, setShowDialog] = useState(false)
    const [platform, setPlatform] = useState<'linux' | 'darwin'>('linux')
    const [profileName, setProfileName] = useState('default')

    const refresh = useCallback(async () => {
        if (!api) return
        setLoading(true)
        try {
            const [enrollRes, runnerRes] = await Promise.all([
                api.listEnrollments(),
                api.listRunners()
            ])
            setEnrollments(enrollRes.enrollments)
            setRunners(runnerRes.runners)
            setError(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }, [api])

    useEffect(() => { refresh() }, [refresh])

    const handleCreateEnrollment = async () => {
        if (!api) return
        try {
            const result = await api.createEnrollment()
            setEnrollmentCode(result)
            setShowDialog(true)
            setError(null)
            refresh()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create enrollment')
        }
    }

    const handleCancelEnrollment = async (id: string) => {
        if (!api) return
        try {
            await api.cancelEnrollment(id)
            refresh()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to cancel')
        }
    }

    const handleRevoke = async (runnerId: string) => {
        if (!api) return
        try {
            await api.revokeRunner(runnerId)
            refresh()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to revoke')
        }
    }

    const handleCleanup = async (runnerId: string) => {
        if (!api) return
        try {
            await api.cleanupRunner(runnerId)
            refresh()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to cleanup')
        }
    }

    const hubUrl = serverUrl || window.location.origin
    const enrollCmd = enrollmentCode
        ? `hapi runner enroll --hub ${hubUrl} --code ${enrollmentCode.code} --profile ${profileName}`
        : ''
    const installCmd = `hapi runner install --profile ${profileName}`
    const installInstructions = platform === 'linux'
        ? `# After enrollment, install as a systemd service:\n${installCmd}\n\n# Check status:\nhapi runner status --profile ${profileName}\n\n# View logs:\nhapi runner logs --profile ${profileName}`
        : `# After enrollment, install as a LaunchAgent:\n${installCmd}\n\n# Check status:\nhapi runner status --profile ${profileName}\n\n# View logs:\nhapi runner logs --profile ${profileName}`

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).catch(() => {})
    }

    if (loading) {
        return <div className="flex-1 overflow-auto p-6"><p className="text-sm text-muted-foreground">Loading...</p></div>
    }

    return (
        <div className="flex-1 overflow-auto p-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl font-semibold">Runners</h1>
                {!isViewer && (
                    <button
                        type="button"
                        onClick={handleCreateEnrollment}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Create Enrollment
                    </button>
                )}
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {error}
                </div>
            )}

            {showDialog && enrollmentCode && (
                <div className="mb-6 rounded-lg border border-border bg-card p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">Enrollment Code</h2>
                        <button
                            type="button"
                            onClick={() => setShowDialog(false)}
                            className="text-sm text-muted-foreground hover:text-foreground"
                        >
                            Close
                        </button>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Profile name</label>
                        <input
                            type="text"
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Platform</label>
                        <div className="flex gap-2">
                            {(['linux', 'darwin'] as const).map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPlatform(p)}
                                    className={`rounded-lg px-3 py-1.5 text-sm ${platform === p ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                                >
                                    {p === 'darwin' ? 'macOS' : 'Linux'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Enroll command</label>
                        <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 font-mono text-sm">
                            <code className="flex-1 break-all">{enrollCmd}</code>
                            <button
                                type="button"
                                onClick={() => copyToClipboard(enrollCmd)}
                                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                            >
                                Copy
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">After enrollment</label>
                        <pre className="rounded-lg bg-secondary px-3 py-2 text-xs overflow-x-auto">{installInstructions}</pre>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        Code expires in {Math.max(0, Math.ceil((enrollmentCode.expiresAt - Date.now()) / 60000))} minutes
                    </p>
                </div>
            )}

            <div className="space-y-8">
                {enrollments.length > 0 && (
                    <section>
                        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Pending Enrollments</h2>
                        <div className="space-y-2">
                            {enrollments.map((e) => (
                                <div key={e.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-medium">
                                            <span className={`inline-block size-1.5 rounded-full mr-2 ${e.status === 'active' ? 'bg-green-500' : e.status === 'expired' ? 'bg-yellow-500' : 'bg-muted-foreground'}`} />
                                            {e.status}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Expires: {new Date(e.expiresAt).toLocaleString()}
                                        </p>
                                    </div>
                                    {!isViewer && (
                                        <button
                                            type="button"
                                            onClick={() => handleCancelEnrollment(e.id)}
                                            className="text-sm text-destructive hover:underline"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <section>
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Enrolled Runners</h2>
                    {runners.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No runners enrolled yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {runners.map((r) => (
                                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-medium">
                                            <span className={`inline-block size-1.5 rounded-full mr-2 ${r.status === 'active' ? 'bg-green-500' : r.status === 'revoked' ? 'bg-red-500' : 'bg-muted-foreground'}`} />
                                            {r.name} ({r.profile})
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Machine: {r.machineId} — Created: {new Date(r.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!isViewer && (
                                            <>
                                                {r.status === 'active' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRevoke(r.id)}
                                                        className="text-sm text-destructive hover:underline"
                                                    >
                                                        Revoke
                                                    </button>
                                                )}
                                                {r.status === 'revoked' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCleanup(r.id)}
                                                        className="text-sm text-muted-foreground hover:underline"
                                                    >
                                                        Clean up
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}
