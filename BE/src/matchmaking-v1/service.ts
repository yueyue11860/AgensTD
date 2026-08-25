import type {
  PvpAcceptedMatch,
  PvpMatchFound,
  PvpQueueJoinRequest,
  PvpQueueTicket,
  PvpSide,
} from '../../../shared/contracts/pvp'
import type {
  MatchmakingClock,
  MatchmakingIdFactory,
  MatchmakingResult,
  PvpQueueJoinCommand,
  PvpQueueStatusSnapshot,
} from './types'

const CONFIRM_WINDOW_MS = 10_000
const BASE_RATING_RANGE = 100
const RATING_EXPANSION_EVERY_MS = 10_000
const RATING_EXPANSION_STEP = 50
const MAX_RATING_RANGE = 400

interface ProposalRuntime {
  found: PvpMatchFound
  acceptedPlayerIds: Set<string>
}

/**
 * 匹配用户画像只能由服务端注入并留在内存边界内。
 * 公开队列合同不得暴露或接受客户端提交的 MMR、排位状态和最近对手。
 */
interface InternalPvpQueueTicket extends PvpQueueTicket {
  rating: number
  isPlacement: boolean
  leaderboardRank: number | null
  recentOpponentIds: string[]
}

interface RequestReceipt {
  fingerprint: string
  result: MatchmakingResult<unknown>
}

class SystemClock implements MatchmakingClock {
  now(): number {
    return Date.now()
  }
}

class SequentialIdFactory implements MatchmakingIdFactory {
  private ticketSequence = 0
  private proposalSequence = 0
  private matchSequence = 0

  nextTicketId(): string {
    this.ticketSequence += 1
    return `pvp-ticket-${this.ticketSequence}`
  }

  nextProposalId(): string {
    this.proposalSequence += 1
    return `pvp-proposal-${this.proposalSequence}`
  }

  nextMatchId(): string {
    this.matchSequence += 1
    return `pvp-match-${Date.now()}-${this.matchSequence}`
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function cloneResult<T>(result: MatchmakingResult<T>): MatchmakingResult<T> {
  return structuredClone(result)
}

export class InMemoryPvpMatchmakingService {
  private readonly tickets = new Map<string, InternalPvpQueueTicket>()
  private readonly activeTicketByPlayer = new Map<string, string>()
  private readonly proposals = new Map<string, ProposalRuntime>()
  private readonly acceptedMatches = new Map<string, PvpAcceptedMatch>()
  private readonly requestReceipts = new Map<string, RequestReceipt>()
  private readonly confirmFailureCount = new Map<string, number>()
  private readonly cooldownUntilByPlayer = new Map<string, number>()
  private proposalAssignmentSequence = 0

  constructor(
    private readonly clock: MatchmakingClock = new SystemClock(),
    private readonly ids: MatchmakingIdFactory = new SequentialIdFactory(),
  ) {}

  join(command: PvpQueueJoinCommand): MatchmakingResult<PvpQueueTicket> {
    const { principal, request, profile } = command
    return this.idempotent(principal.playerId, request.requestId, 'queue_join', { request, profile }, () => {
      if ((principal as { kind?: string }).kind !== 'human') return { ok: false, code: 'HUMAN_ACCOUNT_REQUIRED' }
      if (!principal.playerId.trim() || !principal.playerName.trim()) return { ok: false, code: 'INVALID_PRINCIPAL' }
      if (!request.requestId.trim()) return { ok: false, code: 'REQUEST_ID_REQUIRED' }
      if (request.mode !== 'ranked_1v1' && request.mode !== 'casual_1v1') return { ok: false, code: 'UNSUPPORTED_MODE' }
      if (!request.region.trim() || !request.rulesetVersion.trim()) return { ok: false, code: 'INVALID_QUEUE_DIMENSIONS' }
      if (!Number.isSafeInteger(request.loadoutVersion) || request.loadoutVersion < 0) return { ok: false, code: 'INVALID_LOADOUT_VERSION' }
      if (!Number.isFinite(profile.rating) || profile.rating < 0) return { ok: false, code: 'INVALID_RATING_SNAPSHOT' }
      const now = this.clock.now()
      const cooldownUntil = this.cooldownUntilByPlayer.get(principal.playerId) ?? 0
      if (cooldownUntil > now) {
        return { ok: false, code: 'QUEUE_COOLDOWN', value: undefined }
      }
      const activeTicketId = this.activeTicketByPlayer.get(principal.playerId)
      if (activeTicketId) {
        const activeTicket = this.tickets.get(activeTicketId)
        if (activeTicket && (activeTicket.state === 'searching' || activeTicket.state === 'match_found')) {
          return { ok: false, code: 'ALREADY_QUEUED', value: this.publicTicket(activeTicket) }
        }
      }
      const ticket: InternalPvpQueueTicket = {
        ticketId: this.ids.nextTicketId(),
        playerId: principal.playerId,
        playerName: principal.playerName,
        mode: request.mode,
        region: request.region,
        rulesetVersion: request.rulesetVersion,
        loadoutVersion: request.loadoutVersion,
        rating: profile.rating,
        isPlacement: profile.isPlacement,
        leaderboardRank: profile.leaderboardRank,
        recentOpponentIds: [...new Set(profile.recentOpponentIds)].slice(0, 3),
        state: 'searching',
        createdAt: now,
        searchStartedAt: now,
        proposalId: null,
        priorityReturn: false,
      }
      this.tickets.set(ticket.ticketId, ticket)
      this.activeTicketByPlayer.set(ticket.playerId, ticket.ticketId)
      this.tryCreateProposals()
      return { ok: true, code: 'QUEUE_JOINED', value: this.publicTicket(ticket) }
    })
  }

  cancel(playerId: string, ticketId: string, requestId: string): MatchmakingResult<PvpQueueTicket> {
    return this.idempotent(playerId, requestId, 'queue_cancel', { ticketId }, () => {
      const ticket = this.tickets.get(ticketId)
      if (!ticket || ticket.playerId !== playerId) return { ok: false, code: 'TICKET_NOT_FOUND' }
      if (ticket.state === 'accepted') return { ok: false, code: 'MATCH_ALREADY_ACCEPTED' }
      if (ticket.state === 'cancelled' || ticket.state === 'expired') {
        return { ok: true, code: 'QUEUE_ALREADY_INACTIVE', value: this.publicTicket(ticket) }
      }
      if (ticket.proposalId) this.expireProposal(ticket.proposalId, playerId, true)
      ticket.state = 'cancelled'
      ticket.proposalId = null
      this.activeTicketByPlayer.delete(playerId)
      return { ok: true, code: 'QUEUE_CANCELLED', value: this.publicTicket(ticket) }
    })
  }

  accept(playerId: string, proposalId: string, requestId: string): MatchmakingResult<PvpAcceptedMatch | PvpMatchFound> {
    return this.idempotent<PvpAcceptedMatch | PvpMatchFound>(playerId, requestId, 'match_accept', { proposalId }, () => {
      const proposal = this.proposals.get(proposalId)
      if (!proposal) return { ok: false, code: 'PROPOSAL_NOT_FOUND' }
      const now = this.clock.now()
      if (now >= proposal.found.confirmDeadlineAt) {
        this.expireProposal(proposalId)
        return { ok: false, code: 'CONFIRMATION_EXPIRED' }
      }
      const player = proposal.found.players.find((candidate) => candidate.playerId === playerId)
      if (!player) return { ok: false, code: 'PLAYER_NOT_IN_PROPOSAL' }
      proposal.acceptedPlayerIds.add(playerId)
      proposal.found.acceptedPlayerIds = [...proposal.acceptedPlayerIds].sort()
      if (proposal.acceptedPlayerIds.size < 2) {
        return { ok: true, code: 'MATCH_ACCEPT_RECORDED', value: structuredClone(proposal.found) }
      }

      const accepted = this.createAcceptedMatch(proposal)
      this.acceptedMatches.set(accepted.matchId, accepted)
      this.proposals.delete(proposalId)
      for (const participant of accepted.players) {
        const ticket = this.tickets.get(participant.ticketId)!
        ticket.state = 'accepted'
        ticket.proposalId = proposalId
        this.activeTicketByPlayer.delete(participant.playerId)
        this.confirmFailureCount.delete(participant.playerId)
      }
      return { ok: true, code: 'MATCH_ACCEPTED', value: structuredClone(accepted) }
    })
  }

  advance(): PvpQueueStatusSnapshot {
    const now = this.clock.now()
    for (const proposal of [...this.proposals.values()]) {
      if (now >= proposal.found.confirmDeadlineAt) this.expireProposal(proposal.found.proposalId)
    }
    this.tryCreateProposals()
    return this.snapshot()
  }

  getTicket(ticketId: string): PvpQueueTicket | null {
    const ticket = this.tickets.get(ticketId)
    return ticket ? this.publicTicket(ticket) : null
  }

  getProposal(proposalId: string): PvpMatchFound | null {
    const proposal = this.proposals.get(proposalId)
    return proposal ? structuredClone(proposal.found) : null
  }

  getAcceptedMatch(matchId: string): PvpAcceptedMatch | null {
    const match = this.acceptedMatches.get(matchId)
    return match ? structuredClone(match) : null
  }

  getPlayerCooldownUntil(playerId: string): number {
    return this.cooldownUntilByPlayer.get(playerId) ?? 0
  }

  snapshot(): PvpQueueStatusSnapshot {
    return {
      now: this.clock.now(),
      searching: [...this.tickets.values()]
        .filter((ticket) => ticket.state === 'searching')
        .sort((left, right) => this.ticketPriority(left, right))
        .map((ticket) => this.publicTicket(ticket)),
      proposals: [...this.proposals.values()].map((proposal) => structuredClone(proposal.found)),
      acceptedMatches: [...this.acceptedMatches.values()].map((match) => structuredClone(match)),
    }
  }

  private tryCreateProposals(): void {
    while (true) {
      const searching = [...this.tickets.values()]
        .filter((ticket) => ticket.state === 'searching')
        .sort((left, right) => this.ticketPriority(left, right))
      let pair: [InternalPvpQueueTicket, InternalPvpQueueTicket] | null = null
      for (let leftIndex = 0; leftIndex < searching.length && !pair; leftIndex += 1) {
        const left = searching[leftIndex]!
        const candidates = searching.slice(leftIndex + 1)
          .filter((right) => this.canMatch(left, right))
          .sort((first, second) => this.candidatePriority(left, first, second))
        if (candidates[0]) pair = [left, candidates[0]]
      }
      if (!pair) return
      this.createProposal(pair[0], pair[1])
    }
  }

  private canMatch(left: InternalPvpQueueTicket, right: InternalPvpQueueTicket): boolean {
    if (left.playerId === right.playerId) return false
    if (left.mode !== right.mode || left.rulesetVersion !== right.rulesetVersion || left.region !== right.region) return false
    if ((left.isPlacement && right.leaderboardRank !== null && right.leaderboardRank <= 200)
      || (right.isPlacement && left.leaderboardRank !== null && left.leaderboardRank <= 200)) return false
    const delta = Math.abs(left.rating - right.rating)
    return delta <= Math.min(this.ratingRange(left), this.ratingRange(right))
  }

  private ratingRange(ticket: InternalPvpQueueTicket): number {
    const elapsed = Math.max(0, this.clock.now() - ticket.searchStartedAt)
    return Math.min(MAX_RATING_RANGE, BASE_RATING_RANGE
      + Math.floor(elapsed / RATING_EXPANSION_EVERY_MS) * RATING_EXPANSION_STEP)
  }

  private candidatePriority(
    anchor: InternalPvpQueueTicket,
    left: InternalPvpQueueTicket,
    right: InternalPvpQueueTicket,
  ): number {
    const leftRecent = anchor.recentOpponentIds.includes(left.playerId) ? 1 : 0
    const rightRecent = anchor.recentOpponentIds.includes(right.playerId) ? 1 : 0
    return leftRecent - rightRecent
      || Math.abs(anchor.rating - left.rating) - Math.abs(anchor.rating - right.rating)
      || this.ticketPriority(left, right)
  }

  private ticketPriority(left: InternalPvpQueueTicket, right: InternalPvpQueueTicket): number {
    return Number(right.priorityReturn) - Number(left.priorityReturn)
      || left.searchStartedAt - right.searchStartedAt
      || left.createdAt - right.createdAt
      || left.ticketId.localeCompare(right.ticketId)
  }

  private createProposal(first: InternalPvpQueueTicket, second: InternalPvpQueueTicket): void {
    this.proposalAssignmentSequence += 1
    const ordered = this.proposalAssignmentSequence % 2 === 1 ? [first, second] : [second, first]
    const now = this.clock.now()
    const proposalId = this.ids.nextProposalId()
    const found: PvpMatchFound = {
      proposalId,
      mode: first.mode,
      rulesetVersion: first.rulesetVersion,
      region: first.region,
      confirmDeadlineAt: now + CONFIRM_WINDOW_MS,
      players: ordered.map((ticket) => ({
        playerId: ticket.playerId,
        playerName: ticket.playerName,
        ticketId: ticket.ticketId,
        loadoutVersion: ticket.loadoutVersion,
      })),
      acceptedPlayerIds: [],
    }
    for (const ticket of [first, second]) {
      ticket.state = 'match_found'
      ticket.proposalId = proposalId
      ticket.priorityReturn = false
    }
    this.proposals.set(proposalId, { found, acceptedPlayerIds: new Set() })
  }

  private createAcceptedMatch(proposal: ProposalRuntime): PvpAcceptedMatch {
    const sides: readonly PvpSide[] = ['A', 'B']
    return {
      matchId: this.ids.nextMatchId(),
      proposalId: proposal.found.proposalId,
      mode: proposal.found.mode,
      rulesetVersion: proposal.found.rulesetVersion,
      region: proposal.found.region,
      players: proposal.found.players.map((player, index) => ({ ...player, side: sides[index]! })),
      acceptedAt: this.clock.now(),
    }
  }

  private expireProposal(proposalId: string, cancelledPlayerId?: string, explicitCancel = false): void {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return
    this.proposals.delete(proposalId)
    const now = this.clock.now()
    for (const proposalPlayer of proposal.found.players) {
      const ticket = this.tickets.get(proposalPlayer.ticketId)
      if (!ticket) continue
      const didAccept = proposal.acceptedPlayerIds.has(proposalPlayer.playerId)
      const cancelledSelf = explicitCancel && cancelledPlayerId === proposalPlayer.playerId
      ticket.proposalId = null
      if ((didAccept || (explicitCancel && !cancelledSelf)) && !cancelledSelf) {
        ticket.state = 'searching'
        ticket.priorityReturn = true
        continue
      }
      ticket.state = cancelledSelf ? 'cancelled' : 'expired'
      this.activeTicketByPlayer.delete(ticket.playerId)
      if (!cancelledSelf) this.applyConfirmationFailure(ticket.playerId, now)
    }
  }

  private applyConfirmationFailure(playerId: string, now: number): void {
    const failures = (this.confirmFailureCount.get(playerId) ?? 0) + 1
    this.confirmFailureCount.set(playerId, failures)
    const cooldownMs = failures <= 1 ? 0 : failures === 2 ? 60_000 : failures === 3 ? 5 * 60_000 : 15 * 60_000
    if (cooldownMs > 0) this.cooldownUntilByPlayer.set(playerId, now + cooldownMs)
  }

  private publicTicket(ticket: InternalPvpQueueTicket): PvpQueueTicket {
    return structuredClone({
      ticketId: ticket.ticketId,
      playerId: ticket.playerId,
      playerName: ticket.playerName,
      mode: ticket.mode,
      region: ticket.region,
      rulesetVersion: ticket.rulesetVersion,
      loadoutVersion: ticket.loadoutVersion,
      state: ticket.state,
      createdAt: ticket.createdAt,
      searchStartedAt: ticket.searchStartedAt,
      proposalId: ticket.proposalId,
      priorityReturn: ticket.priorityReturn,
    })
  }

  private idempotent<T>(
    playerId: string,
    requestId: string,
    operation: string,
    payload: Record<string, unknown>,
    apply: () => MatchmakingResult<T>,
  ): MatchmakingResult<T> {
    if (!requestId.trim()) return { ok: false, code: 'REQUEST_ID_REQUIRED' }
    const key = `${playerId}:${requestId}`
    const fingerprint = stableJson({ operation, payload })
    const previous = this.requestReceipts.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) return { ok: false, code: 'REQUEST_ID_CONFLICT' }
      return { ...cloneResult(previous.result as MatchmakingResult<T>), duplicate: true }
    }
    const result = apply()
    this.requestReceipts.set(key, { fingerprint, result: cloneResult(result as MatchmakingResult<unknown>) })
    return result
  }
}
