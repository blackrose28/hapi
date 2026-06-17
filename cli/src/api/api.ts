import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import axios from 'axios'
import type { AgentState, CreateMachineResponse, CreateSessionResponse, RunnerState, Machine, MachineMetadata, Metadata, Session } from '@/api/types'
import type { LocalResumeTarget, ResumableSession } from '@hapi/protocol'
import {
    AgentStateSchema,
    CreateMachineResponseSchema,
    CreateSessionResponseSchema,
    GetSessionResponseSchema,
    LocalHandoffResponseSchema,
    LocalResumeTargetResponseSchema,
    RunnerStateSchema,
    MachineMetadataSchema,
    MetadataSchema,
    ResumableSessionsResponseSchema
} from '@/api/types'
import { configuration } from '@/configuration'
import { readRunnerProfile } from '@/runner/profile'
import { apiValidationError } from '@/utils/errorUtils'
import { ApiMachineClient } from './apiMachine'
import { ApiSessionClient, type ApiSessionClientOptions } from './apiSession'
import { buildHubRequestHeaders } from './hubExtraHeaders'
import type { RunnerCredentialEnvelope } from '@hapi/protocol/runner-enrollment'

export type ApiAuthentication = { kind: 'runner'; credential: RunnerCredentialEnvelope; machineId: string }

export class ApiClient {
    static async create(): Promise<ApiClient> {
        const profileName = process.env.HAPI_RUNNER_PROFILE?.trim()
        if (!profileName) {
            throw new Error('Runner enrollment required. Run `hapi runner enroll --hub <url> --code <code> --profile <name>`, then select it with HAPI_RUNNER_PROFILE=<name>.')
        }
        const enrolled = await readRunnerProfile(
            process.env.HAPI_PROFILE_BASE_HOME ?? configuration.happyHomeDir,
            profileName
        ).catch(() => {
            throw new Error(`Runner profile '${profileName}' is unavailable. Re-enroll with \`hapi runner enroll --profile ${profileName}\`.`)
        })
        configuration._setApiUrl(enrolled.profile.hubUrl)
        return ApiClient.createForRunner(enrolled.credential.credential, enrolled.profile.machineId)
    }
    static createForRunner(credential: RunnerCredentialEnvelope, machineId: string): ApiClient {
        return new ApiClient({ kind: 'runner', credential, machineId })
    }

    private constructor(private readonly authentication:ApiAuthentication) { }
    get machineId(): string { return this.authentication.machineId }
    private headers(): Record<string, string> {
        return {
            Authorization: `Runner ${this.authentication.credential.credentialId}.${this.authentication.credential.secret}`,
            'X-Hapi-Machine-Id': this.authentication.machineId
        }
    }

    private authHeaders(): Record<string, string> {
        return buildHubRequestHeaders({
            ...this.headers(),
            'Content-Type': 'application/json'
        })
    }

    async getOrCreateSession(opts: {
        id?: string
        tag: string
        metadata: Metadata
        state: AgentState | null
        model?: string
        modelReasoningEffort?: string
        effort?: string
        machine?: {
            id: string
            metadata: MachineMetadata
            runnerState?: RunnerState
        }
        timeoutMs?: number
        signal?: AbortSignal
    }): Promise<Session> {
        const response = await axios.post<CreateSessionResponse>(
            `${configuration.apiUrl}/cli/sessions`,
            {
                id: opts.id,
                tag: opts.tag,
                metadata: opts.metadata,
                agentState: opts.state,
                model: opts.model,
                modelReasoningEffort: opts.modelReasoningEffort,
                effort: opts.effort,
                machine: opts.machine
                    ? {
                        id: opts.machine.id,
                        metadata: opts.machine.metadata,
                        runnerState: opts.machine.runnerState ?? null
                    }
                    : undefined
            },
            {
                headers: buildHubRequestHeaders({
                    ...this.headers(),
                    'Content-Type': 'application/json'
                }),
                timeout: opts.timeoutMs ?? 60_000,
                signal: opts.signal
            }
        )

        const parsed = CreateSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions response', response)
        }

        const raw = parsed.data.session

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const agentState = (() => {
            if (raw.agentState == null) return null
            const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
            return parsedAgentState.success ? parsedAgentState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            agentState,
            agentStateVersion: raw.agentStateVersion,
            thinking: raw.thinking,
            thinkingAt: raw.thinkingAt,
            todos: raw.todos,
            model: raw.model,
            modelReasoningEffort: raw.modelReasoningEffort,
            effort: raw.effort,
            serviceTier: raw.serviceTier,
            permissionMode: raw.permissionMode,
            collaborationMode: raw.collaborationMode
        }
    }

    async getSession(sessionId: string): Promise<Session> {
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )

        const parsed = GetSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/:id response', response)
        }

        const raw = parsed.data.session
        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()
        const agentState = (() => {
            if (raw.agentState == null) return null
            const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
            return parsedAgentState.success ? parsedAgentState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            agentState,
            agentStateVersion: raw.agentStateVersion,
            thinking: raw.thinking,
            thinkingAt: raw.thinkingAt,
            todos: raw.todos,
            model: raw.model,
            modelReasoningEffort: raw.modelReasoningEffort,
            effort: raw.effort,
            serviceTier: raw.serviceTier,
            permissionMode: raw.permissionMode,
            collaborationMode: raw.collaborationMode
        }
    }

    async getOrCreateMachine(opts: {
        machineId: string
        metadata: MachineMetadata
        runnerState?: RunnerState
    }): Promise<Machine> {
        const response = await axios.post<CreateMachineResponse>(
            `${configuration.apiUrl}/cli/machines`,
            {
                id: opts.machineId,
                metadata: opts.metadata,
                runnerState: opts.runnerState ?? null
            },
            {
                headers: buildHubRequestHeaders({
                    ...this.headers(),
                    'Content-Type': 'application/json'
                }),
                timeout: 60_000
            }
        )

        const parsed = CreateMachineResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/machines response', response)
        }

        const raw = parsed.data.machine

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MachineMetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const runnerState = (() => {
            if (raw.runnerState == null) return null
            const parsedRunnerState = RunnerStateSchema.safeParse(raw.runnerState)
            return parsedRunnerState.success ? parsedRunnerState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            runnerState,
            runnerStateVersion: raw.runnerStateVersion
        }
    }

    async listResumableSessions(machineId?: string): Promise<ResumableSession[]> {
        const qs = machineId ? `?machineId=${encodeURIComponent(machineId)}` : ''
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/resumable${qs}`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = ResumableSessionsResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/resumable response', response)
        }
        return parsed.data.sessions
    }

    async getLocalResumeTarget(sessionId: string): Promise<LocalResumeTarget> {
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/resume-target`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = LocalResumeTargetResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/:id/resume-target response', response)
        }
        return parsed.data.target
    }

    async handoffSessionToLocal(sessionId: string): Promise<void> {
        const response = await axios.post(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/handoff-local`,
            {},
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = LocalHandoffResponseSchema.safeParse(response.data)
        if (!parsed.success || !parsed.data.ok) {
            throw apiValidationError('Invalid /cli/sessions/:id/handoff-local response', response)
        }
    }

    sessionSyncClient(session: Session, options?: ApiSessionClientOptions): ApiSessionClient {
        return new ApiSessionClient(this.authentication, session, options)
    }

    machineSyncClient(machine: Machine, options?: { workspaceRoot?: string }): ApiMachineClient {
        return new ApiMachineClient(this.authentication, machine, options?.workspaceRoot)
    }
}
