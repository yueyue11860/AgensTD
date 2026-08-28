import type { GatewayPrincipal } from '../network/gateway-auth'
import type { PvpMatchPhase, PvpMode, PvpSide } from '../../../shared/contracts/pvp'
import type { PvpRankTier } from '../../../shared/contracts/pvp-competition'

export interface HumanGatewayPrincipal extends GatewayPrincipal {
  playerKind: 'human'
}

export function isHumanGatewayPrincipal(principal: GatewayPrincipal | null): principal is HumanGatewayPrincipal {
  return principal?.playerKind === 'human'
    && principal.playerId.trim().length > 0
    && principal.playerName.trim().length > 0
}

export interface PvpCustomRoomPlayer {
  playerId: string
  playerName: string
  side: PvpSide
  ready: boolean
  connected: boolean
  isHost: boolean
  tier: PvpRankTier
  division: number | null
}

export interface PvpCustomRoomProjection {
  roomId: string
  roomName: string
  mode: Extract<PvpMode, 'custom_1v1'>
  status: PvpMatchPhase
  mapId: string
  mapName: string
  hasPassword: boolean
  spectatorsAllowed: boolean
  playerCount: number
  maxPlayers: 2
  players: PvpCustomRoomPlayer[]
  createdAt: string
  matchId: string | null
}

export interface CreatePvpCustomRoomInput {
  requestId?: string
  roomName: string
  password?: string
  spectatorsAllowed: boolean
}

export class PvpPlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'PvpPlatformError'
  }
}
