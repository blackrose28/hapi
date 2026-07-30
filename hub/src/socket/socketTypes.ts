import type { CliCapability, ClientToServerEvents, ServerToClientEvents } from '@hapi/protocol'
import type { DefaultEventsMap, Server, Socket } from 'socket.io'

export type SocketData = {
    namespace?: string
    userId?: number
    principalKind?: 'runner'
    runnerClientType?: 'machine-scoped' | 'session-scoped'
    runnerId?: string
    machineId?: string
    organizationId?: string
    membershipId?: string
    organizationRole?: 'admin' | 'member' | 'viewer'
    cliCapabilities?: ReadonlySet<CliCapability>
}

export type SocketServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>
export type SocketWithData = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>
export type CliSocketServer = Server<ServerToClientEvents, ClientToServerEvents, DefaultEventsMap, SocketData>
export type CliSocketWithData = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>
