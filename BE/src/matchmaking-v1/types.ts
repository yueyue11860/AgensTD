import type {
  PvpAcceptedMatch,
  PvpMatchFound,
  PvpQueueJoinRequest,
  PvpQueueTicket,
} from '../../../shared/contracts/pvp'

/** 只能由认证网络边界构造；公开 payload 不得携带或覆盖这些字段。 */
export interface HumanPvpPrincipal {
  kind: 'human'
  playerId: string
  playerName: string
}

/** 只能由段位/历史服务注入；客户端提交的 rating 或最近对手不可信。 */
export interface PvpMatchmakingProfileSnapshot {
  rating: number
  isPlacement: boolean
  leaderboardRank: number | null
  recentOpponentIds: string[]
}

export interface PvpQueueJoinCommand {
  principal: HumanPvpPrincipal
  request: PvpQueueJoinRequest
  profile: PvpMatchmakingProfileSnapshot
}

export interface MatchmakingResult<T = undefined> {
  ok: boolean
  code: string
  duplicate?: boolean
  value?: T
}

export interface PvpQueueStatusSnapshot {
  now: number
  searching: PvpQueueTicket[]
  proposals: PvpMatchFound[]
  acceptedMatches: PvpAcceptedMatch[]
}

export interface MatchmakingClock {
  now(): number
}

export interface MatchmakingIdFactory {
  nextTicketId(): string
  nextProposalId(): string
  nextMatchId(): string
}
