import { createHash, randomUUID } from 'node:crypto'
import type {
  PvpAcceptedMatch,
  PvpAuthorityState,
  PvpMatchFound,
  PvpMode,
  PvpQueueJoinRequest,
  PvpQueueTicket,
  PvpRealtimeState,
  PvpRealtimeEnvelope,
  PvpLoadAckRequest,
  PvpRecruitRequest,
  PvpDeployRequest,
  PvpMoveOrMergeRequest,
  PvpSide,
} from '../../../shared/contracts/pvp'
import type {
  PvpLeaderboardPage,
  PvpMapCatalogEntry,
  PvpMatchDetail,
  PvpMatchHistoryPage,
  PvpModeDefinition,
  PvpRating,
  PvpSeason,
} from '../../../shared/contracts/pvp-competition'
import { MemoryPvpStore } from '../data/memory-pvp-store'
import type { PvpStore, PvpMatchLease, PvpActiveMatchCheckpoint } from '../data/pvp-store'
import { InMemoryPvpMatchmakingService } from '../matchmaking-v1/service'
import { DUAL_REALM_MAP } from '../pvp-v1/map'
import { PvpMatchRuntime, type AuthoritativePvpDamageInput } from '../pvp-v1/runtime'
import { createInitialPvpRating, PVP_RANK_POLICY_VERSION } from '../rank-v1/policy'
import { PvpRankService } from '../rank-v1/service'
import type {
  CreatePvpCustomRoomInput,
  HumanGatewayPrincipal,
  PvpCustomRoomPlayer,
  PvpCustomRoomProjection,
} from './types'
import { PvpPlatformError } from './types'
import { createPasswordCredential, verifyPassword, type PasswordCredential } from '../security/password'

const MODE_VERSION = '1'
const RULESET_VERSION = 'pvp_rules_v1'
const MAP_VERSION = '1'
const MAP_NAME = '两界斗法台'
const REGION = 'auto'
const CATALOG_VERSION = 'pvp_catalog_v1'
const EFFECT_SYSTEM_VERSION = 'effect_v1'
const TICK_RATE_MS = 100
const ROOM_PASSWORD_ATTEMPT_WINDOW_MS = 60_000
const ROOM_PASSWORD_ATTEMPT_MAX = 5

interface LiveMatch {
  runtime: PvpMatchRuntime
  mode: PvpMode
  region: string
  seasonId: string
  createdAt: string
  participants: Array<{
    playerId: string
    playerName: string
    side: PvpSide
    loadoutVersion: number
  }>
  settling: boolean
  settledDetail: PvpMatchDetail | null
  settledAtMs: number | null
  realtimeSeq: number
  realtimeConnections: Map<string, number>
  lease: PvpMatchLease | null
  checkpointSave: Promise<void>
}

interface MatchSubscriber {
  playerId: string
  listener: (envelope: PvpRealtimeEnvelope) => void
}

interface CustomRoomRuntime {
  roomId: string
  roomName: string
  passwordCredential: PasswordCredential | null
  spectatorsAllowed: boolean
  createdAt: string
  createdAtMs: number
  hostPlayerId: string
  players: PvpCustomRoomPlayer[]
  matchId: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function activeCheckpointHash(runtime: unknown, metadata: unknown): string {
  return createHash('sha256').update(JSON.stringify({ runtime, metadata })).digest('hex')
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return fallback
  return Math.max(1, Math.min(100, Math.trunc(value!)))
}

export interface PvpPlatformServiceOptions {
  store?: PvpStore
  autoTick?: boolean
  /** 仅用于可复现集成测试；生产默认保持 100ms 权威 tick。 */
  runtimeTickRateMs?: number
  timerIntervalMs?: number
  countdownMs?: number
  roundIntervalMs?: number
  disconnectForfeitMs?: number
  /** 终局状态供断线页面回看的内存宽限；详情始终以 store 为权威。 */
  terminalRetentionMs?: number
  /** 宽限期内终局对局的最大内存数，超限时优先回收最旧无连接对局。 */
  maxRetainedTerminalMatches?: number
  activeMatchLeaseTtlMs?: number
  holderId?: string
  /** 仅供可控时钟 smoke。 */
  nowMs?: () => number
  /** 未开始自定义房的内存索引 TTL。 */
  waitingRoomTtlMs?: number
  /** 单个玩家同时持有的未开始自定义房配额。 */
  maxRoomsPerPlayer?: number
  /** SSE 连接配额，避免恶意重连令订阅索引无界增长。 */
  maxSubscribersPerMatch?: number
  maxConnectionsPerPlayer?: number
}

/**
 * PVP 竖向装配层。它只编排匹配、权威战斗与竞技持久化，不复制三个子域的规则。
 */
export class PvpPlatformService {
  readonly store: PvpStore
  readonly matchmaking: InMemoryPvpMatchmakingService
  readonly rank: PvpRankService
  readonly ready: Promise<void>

  private readonly liveMatches = new Map<string, LiveMatch>()
  private readonly customRooms = new Map<string, CustomRoomRuntime>()
  private readonly customRoomReceipts = new Map<string, { fingerprint: string; roomId: string; createdAtMs: number }>()
  private readonly roomPasswordAttempts = new Map<string, { windowStartedAt: number; count: number; blockedUntil: number }>()
  private readonly matchSubscribers = new Map<string, Set<MatchSubscriber>>()
  private tickTimer: NodeJS.Timeout | null
  private readonly runtimeOptions: Required<Pick<PvpPlatformServiceOptions, 'runtimeTickRateMs' | 'countdownMs'>> & Pick<PvpPlatformServiceOptions, 'roundIntervalMs' | 'disconnectForfeitMs'>
  private readonly terminalRetentionMs: number
  private readonly maxRetainedTerminalMatches: number
  private readonly waitingRoomTtlMs: number
  private readonly maxRoomsPerPlayer: number
  private readonly maxSubscribersPerMatch: number
  private readonly maxConnectionsPerPlayer: number
  private readonly nowMs: () => number
  private readonly holderId: string
  private readonly activeMatchLeaseTtlMs: number

  constructor(options: PvpPlatformServiceOptions = {}) {
    this.store = options.store ?? new MemoryPvpStore()
    this.matchmaking = new InMemoryPvpMatchmakingService()
    this.rank = new PvpRankService(this.store)
    this.holderId = options.holderId ?? `pvp-worker-${randomUUID()}`
    this.activeMatchLeaseTtlMs = Math.max(5_000, Math.trunc(options.activeMatchLeaseTtlMs ?? 30_000))
    this.ready = this.bootstrapCatalog().then(() => this.restoreActiveMatches())
    this.runtimeOptions = {
      runtimeTickRateMs: Math.max(10, Math.trunc(options.runtimeTickRateMs ?? TICK_RATE_MS)),
      countdownMs: Math.max(0, Math.trunc(options.countdownMs ?? 5000)),
      roundIntervalMs: options.roundIntervalMs,
      disconnectForfeitMs: options.disconnectForfeitMs,
    }
    this.terminalRetentionMs = Math.max(0, Math.trunc(options.terminalRetentionMs ?? 5 * 60_000))
    this.maxRetainedTerminalMatches = Math.max(0, Math.trunc(options.maxRetainedTerminalMatches ?? 500))
    this.waitingRoomTtlMs = Math.max(60_000, Math.trunc(options.waitingRoomTtlMs ?? 30 * 60_000))
    this.maxRoomsPerPlayer = Math.max(1, Math.trunc(options.maxRoomsPerPlayer ?? 3))
    this.maxSubscribersPerMatch = Math.max(1, Math.trunc(options.maxSubscribersPerMatch ?? 100))
    this.maxConnectionsPerPlayer = Math.max(1, Math.trunc(options.maxConnectionsPerPlayer ?? 3))
    this.nowMs = options.nowMs ?? Date.now
    this.tickTimer = options.autoTick === false ? null : setInterval(() => this.tick(), Math.max(1, Math.trunc(options.timerIntervalMs ?? TICK_RATE_MS)))
    this.tickTimer?.unref()
  }

  shutdown(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  diagnostics() {
    let realtimeConnections = 0
    for (const live of this.liveMatches.values()) for (const count of live.realtimeConnections.values()) realtimeConnections += count
    return {
      tickTimerActive: this.tickTimer ? 1 : 0,
      liveMatches: this.liveMatches.size,
      activeMatches: [...this.liveMatches.values()].filter((live) => !live.runtime.isQuiescent()).length,
      customRooms: this.customRooms.size,
      retainedTerminalMatches: [...this.liveMatches.values()].filter((live) => live.runtime.isQuiescent()).length,
      subscriberCount: [...this.matchSubscribers.values()].reduce((total, subscribers) => total + subscribers.size, 0),
      realtimeConnections,
    }
  }

  injectRealtimeGapForE2e(matchId: string, skipped = 1): void {
    if (process.env.NODE_ENV === 'production' || process.env.PVP_E2E_ENABLED !== 'true') throw new Error('PVP_E2E_GAP_INJECTION_FORBIDDEN')
    const live = this.liveMatches.get(matchId)
    if (!live) throw new PvpPlatformError('MATCH_NOT_FOUND', 'PVP 对局不存在', 404)
    live.realtimeSeq += Math.max(1, Math.min(10, Math.trunc(skipped)))
  }

  async currentSeason(mode: PvpMode = 'ranked_1v1'): Promise<PvpSeason & { rulesetVersion: string; mapIds: string[] }> {
    await this.ready
    const season = (await this.store.listSeasons(mode)).find(candidate => candidate.status === 'active')
    if (!season) throw new PvpPlatformError('PVP_SEASON_NOT_FOUND', '当前没有可用的 PVP 赛季', 404)
    return { ...season, rulesetVersion: RULESET_VERSION, mapIds: [DUAL_REALM_MAP.mapId] }
  }

  async profile(principal: HumanGatewayPrincipal) {
    const season = await this.currentSeason('ranked_1v1')
    const rating = await this.ratingOrInitial(season, principal.playerId)
    const leaderboard = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: 'ranked_1v1', limit: 100 })
    const rank = leaderboard.entries.find(entry => entry.playerId === principal.playerId)?.rank ?? null
    const history = await this.store.listMatchHistory({ playerId: principal.playerId, seasonId: season.seasonId, limit: 10 })
    const cooldownUntil = this.matchmaking.getPlayerCooldownUntil(principal.playerId)
    return {
      playerId: principal.playerId,
      playerName: principal.playerName,
      avatarUrl: null,
      tutorialCompleted: true,
      loadoutValid: true,
      queuePenaltyUntil: cooldownUntil > Date.now()
        ? new Date(cooldownUntil).toISOString()
        : null,
      region: REGION,
      rating: { ...rating, visibleLp: rating.leaguePoints, rank, peakLp: rating.leaguePoints },
      recentMatchIds: history.entries.map(entry => entry.match.matchId),
    }
  }

  async leaderboard(principal: HumanGatewayPrincipal, limit?: number, cursor?: string | null): Promise<PvpLeaderboardPage & { scope: 'global'; self: PvpLeaderboardPage['entries'][number] | null }> {
    const season = await this.currentSeason('ranked_1v1')
    const page = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: 'ranked_1v1', limit: clampLimit(limit, 50), cursor })
    let self = page.entries.find(entry => entry.playerId === principal.playerId) ?? null
    if (!self) {
      const complete = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: 'ranked_1v1', limit: 100 })
      self = complete.entries.find(entry => entry.playerId === principal.playerId) ?? null
    }
    return { ...page, scope: 'global', self }
  }

  async history(principal: HumanGatewayPrincipal, limit?: number, cursor?: string | null): Promise<PvpMatchHistoryPage> {
    await this.ready
    return this.store.listMatchHistory({ playerId: principal.playerId, limit: clampLimit(limit, 20), cursor })
  }

  async matchDetail(principal: HumanGatewayPrincipal, matchId: string): Promise<PvpMatchDetail | Record<string, unknown>> {
    await this.ready
    const settled = await this.store.getMatchDetail(matchId)
    if (settled) {
      this.assertParticipant(settled.participants.map(player => player.playerId), principal.playerId)
      return settled
    }
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const state = live.runtime.snapshot()
    return {
      match: {
        matchId,
        seasonId: live.seasonId,
        modeId: live.mode,
        mapId: state.mapId,
        mapVersion: String(state.mapVersion),
        rulesetVersion: state.rulesetVersion,
        status: state.phase,
        startedAt: live.createdAt,
        endedAt: null,
        durationMs: state.tick * state.tickRateMs,
      },
      participants: live.participants.map(participant => ({
        ...participant,
        stats: state.sides[participant.side]?.stats ?? {},
      })),
      settlements: [],
      replayAvailable: false,
      replayStatus: 'processing',
    }
  }

  matchState(principal: HumanGatewayPrincipal, matchId: string): PvpRealtimeState {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    return live.runtime.projectForViewer(principal.playerId)
  }

  acknowledgeLoad(principal: HumanGatewayPrincipal, matchId: string, input: PvpLoadAckRequest) {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const result = live.runtime.acknowledgeLoad(principal.playerId, input)
    this.publishMatchState(matchId, live)
    // A failed ACK moves directly to `voided`; the regular tick loop skips
    // quiescent runtimes, so settlement must be scheduled from this command.
    if (result.ok && live.runtime.snapshot().phase === 'voided') void this.settleIfNeeded(live)
    return result
  }

  subscribeMatchState(principal: HumanGatewayPrincipal, matchId: string, listener: MatchSubscriber['listener']): () => void {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const subscriber = { playerId: principal.playerId, listener }
    const subscribers = this.matchSubscribers.get(matchId) ?? new Set<MatchSubscriber>()
    subscribers.add(subscriber)
    this.matchSubscribers.set(matchId, subscribers)
    const connectionCount = live.realtimeConnections.get(principal.playerId) ?? 0
    live.realtimeConnections.set(principal.playerId, connectionCount + 1)
    if (connectionCount === 0) live.runtime.markReconnected(principal.playerId)
    listener({ kind: 'full', matchId, seq: live.realtimeSeq, state: live.runtime.projectForViewer(principal.playerId) })
    return () => {
      subscribers.delete(subscriber)
      const remaining = Math.max(0, (live.realtimeConnections.get(principal.playerId) ?? 1) - 1)
      if (remaining === 0) {
        live.realtimeConnections.delete(principal.playerId)
        live.runtime.markDisconnected(principal.playerId)
        this.publishMatchState(matchId, live)
      } else live.realtimeConnections.set(principal.playerId, remaining)
      if (subscribers.size === 0) this.matchSubscribers.delete(matchId)
    }
  }

  /** Validate the SSE quota before the HTTP handler flushes response headers. */
  assertRealtimeCapacity(principal: HumanGatewayPrincipal, matchId: string): void {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const subscribers = this.matchSubscribers.get(matchId)
    if ((subscribers?.size ?? 0) >= this.maxSubscribersPerMatch) {
      throw new PvpPlatformError('REALTIME_CAPACITY_EXCEEDED', '该对局实时连接数已达上限', 429)
    }
    if ((live.realtimeConnections.get(principal.playerId) ?? 0) >= this.maxConnectionsPerPlayer) {
      throw new PvpPlatformError('REALTIME_PLAYER_CONNECTION_LIMIT', '该玩家实时连接数已达上限', 429)
    }
  }

  async joinQueue(principal: HumanGatewayPrincipal, request: PvpQueueJoinRequest) {
    await this.ready
    if (request.mode === 'ranked_1v1' && process.env.NODE_ENV === 'production' && process.env.PVP_RANKED_ENABLED !== 'true') {
      throw new PvpPlatformError('PVP_TECH_PREVIEW_ONLY', '排位入口尚未对生产开放', 403)
    }
    const activeMatch = [...this.liveMatches.values()].find(live => (
      live.participants.some(participant => participant.playerId === principal.playerId)
      && !['completed', 'voided'].includes(live.runtime.snapshot().phase)
    ))
    if (activeMatch) throw new PvpPlatformError('ALREADY_IN_MATCH', '当前账号已在 PVP 对局中', 409)
    const season = await this.currentSeason(request.mode)
    if (request.rulesetVersion !== RULESET_VERSION && request.rulesetVersion !== 'current') {
      throw new PvpPlatformError('RULESET_VERSION_MISMATCH', '客户端 PVP 规则版本已过期', 409)
    }
    const rating = await this.ratingOrInitial(season, principal.playerId)
    const recent = await this.store.listMatchHistory({ playerId: principal.playerId, seasonId: season.seasonId, modeId: request.mode, limit: 3 })
    const board = await this.store.getLeaderboard({ seasonId: season.seasonId, modeId: request.mode, limit: 100 })
    const result = this.matchmaking.join({
      principal: { kind: 'human', playerId: principal.playerId, playerName: principal.playerName },
      request: { ...request, region: REGION, rulesetVersion: RULESET_VERSION },
      profile: {
        rating: rating.rating,
        isPlacement: rating.provisionalGames < 5,
        leaderboardRank: board.entries.find(entry => entry.playerId === principal.playerId)?.rank ?? null,
        recentOpponentIds: recent.entries.flatMap(entry => entry.opponents.map(opponent => opponent.playerId)).slice(0, 3),
      },
    })
    if (!result.ok || !result.value) throw new PvpPlatformError(result.code, result.code, result.code === 'ALREADY_QUEUED' ? 409 : 422)
    return this.queueEnvelope(result.value)
  }

  queueStatus(principal: HumanGatewayPrincipal, ticketId: string) {
    this.matchmaking.advance()
    const ticket = this.matchmaking.getTicket(ticketId)
    if (!ticket || ticket.playerId !== principal.playerId) throw new PvpPlatformError('TICKET_NOT_FOUND', '匹配票据不存在', 404)
    return this.queueEnvelope(ticket)
  }

  cancelQueue(principal: HumanGatewayPrincipal, ticketId: string, requestId: string) {
    const result = this.matchmaking.cancel(principal.playerId, ticketId, requestId)
    if (!result.ok) throw new PvpPlatformError(result.code, result.code, result.code === 'TICKET_NOT_FOUND' ? 404 : 409)
    return { ticket: result.value ?? null }
  }

  async acceptProposal(principal: HumanGatewayPrincipal, proposalId: string, requestId: string) {
    await this.ready
    const result = this.matchmaking.accept(principal.playerId, proposalId, requestId)
    if (!result.ok || !result.value) throw new PvpPlatformError(result.code, result.code, result.code === 'PROPOSAL_NOT_FOUND' ? 404 : 409)
    if ('matchId' in result.value) await this.activateAcceptedMatch(result.value)
    const ticket = this.findPlayerTicket(principal.playerId, proposalId)
    return {
      ticket,
      proposal: 'confirmDeadlineAt' in result.value ? result.value : this.matchmaking.getProposal(proposalId),
      match: 'matchId' in result.value ? result.value : null,
      acceptedMatch: 'matchId' in result.value ? result.value : null,
    }
  }

  sendPressure(principal: HumanGatewayPrincipal, matchId: string, requestId: string) {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const result = live.runtime.sendPressure(principal.playerId, requestId)
    this.publishMatchState(matchId, live)
    return result
  }

  recruit(principal: HumanGatewayPrincipal, matchId: string, input: PvpRecruitRequest) {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const result = live.runtime.recruit(principal.playerId, input)
    this.publishMatchState(matchId, live)
    return result
  }

  deploy(principal: HumanGatewayPrincipal, matchId: string, input: PvpDeployRequest) {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const result = live.runtime.deploy(principal.playerId, input)
    this.publishMatchState(matchId, live)
    return result
  }

  moveOrMerge(principal: HumanGatewayPrincipal, matchId: string, input: PvpMoveOrMergeRequest) {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const result = live.runtime.moveOrMerge(principal.playerId, input)
    this.publishMatchState(matchId, live)
    return result
  }

  /** 仅供服务端战斗解析器调用；REST/Socket 绝不得接收客户端伤害数值后转发。 */
  applyAuthoritativeDamage(matchId: string, input: AuthoritativePvpDamageInput) {
    const live = this.liveMatches.get(matchId)
    if (!live) throw new PvpPlatformError('MATCH_NOT_FOUND', 'PVP 对局不存在', 404)
    return live.runtime.applyAuthoritativeDamage(input)
  }

  async surrender(principal: HumanGatewayPrincipal, matchId: string, requestId: string) {
    const live = this.requireLiveMatchForPlayer(matchId, principal.playerId)
    const result = live.runtime.surrender(principal.playerId, requestId)
    if (result.ok) await this.settleIfNeeded(live)
    this.publishMatchState(matchId, live)
    return result
  }

  async listRooms(): Promise<PvpCustomRoomProjection[]> {
    await this.ready
    return [...this.customRooms.values()].map(room => this.projectRoom(room))
  }

  createRoom(principal: HumanGatewayPrincipal, input: CreatePvpCustomRoomInput): PvpCustomRoomProjection {
    if (input.requestId) {
      const key = `${principal.playerId}:${input.requestId}`
      const fingerprint = JSON.stringify({ roomName: input.roomName, password: input.password ?? null, spectatorsAllowed: input.spectatorsAllowed })
      const previous = this.customRoomReceipts.get(key)
      if (previous) {
        if (!this.customRooms.has(previous.roomId)) {
          this.customRoomReceipts.delete(key)
        } else {
          if (previous.fingerprint !== fingerprint) throw new PvpPlatformError('REQUEST_ID_CONFLICT', 'requestId was reused with a different room payload', 409)
          return this.getRoom(previous.roomId)
        }
      }
    }
    this.assertNoActiveMatch(principal.playerId)
    const ownedOpenRooms = [...this.customRooms.values()].filter(room => !room.matchId
      && room.players.some(player => player.playerId === principal.playerId)).length
    if (ownedOpenRooms >= this.maxRoomsPerPlayer) {
      throw new PvpPlatformError('ROOM_QUOTA_EXCEEDED', '同时创建的未开始房间已达上限', 429)
    }
    const roomName = input.roomName?.trim()
    if (!roomName || roomName.length > 40) throw new PvpPlatformError('INVALID_ROOM_NAME', '房间名称长度必须为 1–40', 422)
    if (input.password !== undefined && input.password.length > 128) throw new PvpPlatformError('INVALID_ROOM_PASSWORD', '房间密码长度不能超过 128 个字符', 422)
    const roomId = `PVP-${randomUUID().slice(0, 8).toUpperCase()}`
    const room: CustomRoomRuntime = {
      roomId,
      roomName,
      passwordCredential: input.password ? createPasswordCredential(input.password) : null,
      spectatorsAllowed: input.spectatorsAllowed === true,
      createdAt: nowIso(),
      createdAtMs: this.nowMs(),
      hostPlayerId: principal.playerId,
      players: [this.customRoomPlayer(principal, 'A', true)],
      matchId: null,
    }
    this.customRooms.set(roomId, room)
    if (input.requestId) {
      this.customRoomReceipts.set(`${principal.playerId}:${input.requestId}`, {
        fingerprint: JSON.stringify({ roomName: input.roomName, password: input.password ?? null, spectatorsAllowed: input.spectatorsAllowed }),
        roomId,
        createdAtMs: this.nowMs(),
      })
    }
    return this.projectRoom(room)
  }

  getRoom(roomId: string): PvpCustomRoomProjection {
    return this.projectRoom(this.requireRoom(roomId))
  }

  async joinRoom(principal: HumanGatewayPrincipal, roomId: string, password = ''): Promise<PvpCustomRoomProjection> {
    this.assertNoActiveMatch(principal.playerId)
    const room = this.requireRoom(roomId)
    if (room.matchId) throw new PvpPlatformError('ROOM_ALREADY_STARTED', '房间已经开始', 409)
    if (room.players.some(player => player.playerId === principal.playerId)) return this.projectRoom(room)
    if (room.players.length >= 2) throw new PvpPlatformError('ROOM_FULL', '房间已满', 409)
    if (room.passwordCredential) {
      const key = `${roomId}:${principal.playerId}`
      const now = this.nowMs()
      const current = this.roomPasswordAttempts.get(key)
      if (current && current.blockedUntil > now) {
        throw new PvpPlatformError('PASSWORD_ATTEMPTS_EXCEEDED', '密码尝试次数过多，请稍后再试', 429)
      }
      const state = !current || now - current.windowStartedAt >= ROOM_PASSWORD_ATTEMPT_WINDOW_MS
        ? { windowStartedAt: now, count: 0, blockedUntil: 0 }
        : current
      if (!password || !verifyPassword(password, room.passwordCredential)) {
        state.count += 1
        if (state.count >= ROOM_PASSWORD_ATTEMPT_MAX) state.blockedUntil = now + ROOM_PASSWORD_ATTEMPT_WINDOW_MS
        this.roomPasswordAttempts.set(key, state)
        if (state.blockedUntil > now) throw new PvpPlatformError('PASSWORD_ATTEMPTS_EXCEEDED', '密码尝试次数过多，请稍后再试', 429)
        throw new PvpPlatformError(password ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED', password ? '房间密码错误' : '加入密码房必须提供 password', password ? 403 : 401)
      }
      this.roomPasswordAttempts.delete(key)
    }
    room.players.push(this.customRoomPlayer(principal, 'B', false))
    return this.projectRoom(room)
  }

  async setRoomReady(principal: HumanGatewayPrincipal, roomId: string, ready: boolean): Promise<PvpCustomRoomProjection> {
    const room = this.requireRoom(roomId)
    const player = room.players.find(candidate => candidate.playerId === principal.playerId)
    if (!player) throw new PvpPlatformError('NOT_IN_ROOM', '你不在该自定义房中', 403)
    if (room.matchId) return this.projectRoom(room)
    player.ready = ready
    if (room.players.length === 2 && room.players.every(candidate => candidate.ready)) {
      const matchId = `pvp-custom-${Date.now()}-${randomUUID().slice(0, 6)}`
      room.matchId = matchId
      const acceptedAt = Date.now()
      await this.activateMatch({
        matchId,
        mode: 'custom_1v1',
        region: REGION,
        rulesetVersion: RULESET_VERSION,
        acceptedAt,
        players: room.players.map(playerEntry => ({
          playerId: playerEntry.playerId,
          playerName: playerEntry.playerName,
          side: playerEntry.side,
          loadoutVersion: 0,
        })),
      })
    }
    return this.projectRoom(room)
  }

  /** 供 smoke 与可控时钟宿主主动推进；生产默认由 100ms 定时器调用。 */
  tick(): void {
    this.matchmaking.advance()
    this.matchmaking.prune()
    for (const live of this.liveMatches.values()) {
      // A fenced/expired owner must stop advancing authority immediately;
      // only a successor holding the lease may tick this match.
      if (!live.lease || Date.parse(live.lease.leaseExpiresAt) <= this.nowMs()) continue
      // `voided` is terminal for simulation but not for persistence. Retry a
      // failed no-contest settlement on subsequent host ticks until an
      // immutable detail exists; otherwise the reaper can never reclaim it.
      if (live.runtime.isQuiescent()) {
        if (live.runtime.snapshot().phase === 'voided' && !live.settledDetail) void this.settleIfNeeded(live)
        continue
      }
      const state = live.runtime.tick()
      this.publishMatchState(state.matchId, live)
      void this.queueCheckpoint(live)
      if (state.phase === 'settling' || state.phase === 'voided') void this.settleIfNeeded(live)
    }
    this.reapTerminalMatches()
  }

  private async bootstrapCatalog(): Promise<void> {
    const now = Date.now()
    const createdAt = new Date(now).toISOString()
    const modeDefinitions: PvpModeDefinition[] = [
      { modeId: 'ranked_1v1', version: MODE_VERSION, name: '排位斗法', teamSize: 1, ranked: true, rewardScaleBps: 10_000, rulesetVersion: RULESET_VERSION, mapPoolVersion: 'pvp_maps_v1', enabled: true, createdAt, updatedAt: createdAt },
      { modeId: 'casual_1v1', version: MODE_VERSION, name: '休闲斗法', teamSize: 1, ranked: false, rewardScaleBps: 5_000, rulesetVersion: RULESET_VERSION, mapPoolVersion: 'pvp_maps_v1', enabled: true, createdAt, updatedAt: createdAt },
      { modeId: 'custom_1v1', version: MODE_VERSION, name: '自定义斗法', teamSize: 1, ranked: false, rewardScaleBps: 0, rulesetVersion: RULESET_VERSION, mapPoolVersion: 'pvp_maps_v1', enabled: true, createdAt, updatedAt: createdAt },
    ]
    for (const definition of modeDefinitions) await this.store.upsertMode(definition)
    const map: PvpMapCatalogEntry = {
      mapId: DUAL_REALM_MAP.mapId,
      version: MAP_VERSION,
      name: MAP_NAME,
      config: { width: DUAL_REALM_MAP.width, height: DUAL_REALM_MAP.height, routeHash: DUAL_REALM_MAP.routeHash },
      checksum: DUAL_REALM_MAP.routeHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    }
    await this.store.upsertMap(map)
    for (const definition of modeDefinitions) {
      const seasonId = `season-1-${definition.modeId}`
      await this.store.upsertSeason({
        seasonId,
        modeId: definition.modeId,
        modeVersion: MODE_VERSION,
        region: REGION,
        name: definition.modeId === 'ranked_1v1' ? '齐天之路·S1' : `${definition.name}·S1`,
        status: 'active',
        startsAt: new Date(now - 7 * 86_400_000).toISOString(),
        locksAt: new Date(now + 49 * 86_400_000).toISOString(),
        endsAt: new Date(now + 50 * 86_400_000).toISOString(),
        rankPolicyVersion: PVP_RANK_POLICY_VERSION,
        rewardPolicyVersion: 'pvp_reward_v1',
        createdAt,
        updatedAt: createdAt,
      })
    }
  }

  private async restoreActiveMatches(): Promise<void> {
    let checkpoints: readonly PvpActiveMatchCheckpoint[] = []
    try { checkpoints = await this.store.listActiveMatchCheckpoints(500) }
    catch (error) { console.error('PVP active checkpoint discovery failed:', error); return }
    for (const checkpoint of checkpoints) {
      if (checkpoint.runtime.phase === 'completed' || checkpoint.runtime.phase === 'voided') continue
      try {
        if (checkpoint.schemaVersion !== 1 || checkpoint.runtime.schemaVersion !== 1
          || checkpoint.runtime.options.rulesetVersion !== RULESET_VERSION
          || activeCheckpointHash(checkpoint.runtime, checkpoint.metadata) !== checkpoint.stateHash) throw new Error('PVP_CHECKPOINT_INTEGRITY_INVALID')
        const lease = await this.store.claimActiveMatchLease({ matchId: checkpoint.matchId, holderId: this.holderId, ttlMs: this.activeMatchLeaseTtlMs })
        const runtime = PvpMatchRuntime.restoreCheckpoint(checkpoint.runtime)
        const metadata = checkpoint.metadata
        const live: LiveMatch = {
          runtime,
          mode: metadata.mode as PvpMode,
          region: metadata.region,
          seasonId: metadata.seasonId,
          createdAt: metadata.createdAt,
          participants: metadata.participants.map(player => ({ ...player })),
          settling: false,
          settledDetail: null,
          settledAtMs: null,
          realtimeSeq: 1,
          realtimeConnections: new Map(),
          lease,
          checkpointSave: Promise.resolve(),
        }
        this.liveMatches.set(checkpoint.matchId, live)
        const savedRoom = metadata.room
        if (savedRoom && !this.customRooms.has(savedRoom.roomId)) {
          this.customRooms.set(savedRoom.roomId, {
            roomId: savedRoom.roomId,
            roomName: savedRoom.roomName,
            passwordCredential: savedRoom.passwordCredential as unknown as PasswordCredential | null,
            spectatorsAllowed: savedRoom.spectatorsAllowed,
            createdAt: savedRoom.createdAt,
            createdAtMs: Date.parse(savedRoom.createdAt),
            hostPlayerId: savedRoom.hostPlayerId,
            players: savedRoom.players as unknown as PvpCustomRoomPlayer[],
            matchId: savedRoom.matchId,
          })
        }
        await this.queueCheckpoint(live)
      }
      catch (error) { console.error(`PVP active checkpoint recovery failed for ${checkpoint.matchId}:`, error) }
    }
  }

  private queueCheckpoint(live: LiveMatch): Promise<void> {
    live.checkpointSave = live.checkpointSave.then(async () => {
      if (!live.lease) return
      live.lease = await this.store.renewActiveMatchLease(live.lease, this.activeMatchLeaseTtlMs)
      const runtime = live.runtime.checkpoint()
      await this.store.saveActiveMatchCheckpoint(live.lease, {
        schemaVersion: 1,
        matchId: runtime.options.matchId,
        checkpointTick: runtime.currentTick,
        stateHash: activeCheckpointHash(runtime, {
          mode: live.mode,
          region: live.region,
          seasonId: live.seasonId,
          createdAt: live.createdAt,
          participants: live.participants.map(player => ({ ...player })),
          room: (() => {
            const room = [...this.customRooms.values()].find(candidate => candidate.matchId === runtime.options.matchId)
            return room ? {
              roomId: room.roomId,
              roomName: room.roomName,
              passwordCredential: room.passwordCredential ? structuredClone(room.passwordCredential) as unknown as Record<string, unknown> : null,
              spectatorsAllowed: room.spectatorsAllowed,
              createdAt: room.createdAt,
              hostPlayerId: room.hostPlayerId,
              players: structuredClone(room.players) as unknown as Array<Record<string, unknown>>,
              matchId: room.matchId,
            } : undefined
          })(),
        }),
        runtime,
        metadata: {
          mode: live.mode,
          region: live.region,
          seasonId: live.seasonId,
          createdAt: live.createdAt,
          participants: live.participants.map(player => ({ ...player })),
          room: (() => {
            const room = [...this.customRooms.values()].find(candidate => candidate.matchId === runtime.options.matchId)
            return room ? {
              roomId: room.roomId,
              roomName: room.roomName,
              passwordCredential: room.passwordCredential ? structuredClone(room.passwordCredential) as unknown as Record<string, unknown> : null,
              spectatorsAllowed: room.spectatorsAllowed,
              createdAt: room.createdAt,
              hostPlayerId: room.hostPlayerId,
              players: structuredClone(room.players) as unknown as Array<Record<string, unknown>>,
              matchId: room.matchId,
            } : undefined
          })(),
        },
        createdAt: nowIso(),
      })
    }).catch((error) => { console.error(`PVP active checkpoint save failed for ${live.runtime.snapshot().matchId}:`, error) })
    return live.checkpointSave
  }

  private async ratingOrInitial(season: PvpSeason, playerId: string): Promise<PvpRating> {
    return await this.store.getRating(season.seasonId, season.modeId, playerId)
      ?? createInitialPvpRating({ seasonId: season.seasonId, modeId: season.modeId, playerId, at: nowIso() })
  }

  private queueEnvelope(ticket: PvpQueueTicket) {
    const proposal = ticket.proposalId ? this.matchmaking.getProposal(ticket.proposalId) : null
    const acceptedMatch = this.matchmaking.snapshot().acceptedMatches.find(match => match.players.some(player => player.ticketId === ticket.ticketId)) ?? null
    const elapsed = Math.max(0, Date.now() - ticket.searchStartedAt)
    return {
      ticket: {
        ...ticket,
        searchRange: Math.min(400, 100 + Math.floor(elapsed / 10_000) * 50),
        estimatedWaitSeconds: 15,
        proposal,
        acceptedMatch,
      },
      proposal,
      match: acceptedMatch,
      acceptedMatch,
    }
  }

  private findPlayerTicket(playerId: string, proposalId: string): PvpQueueTicket | null {
    const proposal = this.matchmaking.getProposal(proposalId)
    const ticketId = proposal?.players.find(player => player.playerId === playerId)?.ticketId
      ?? this.matchmaking.snapshot().acceptedMatches
        .find(match => match.proposalId === proposalId)?.players.find(player => player.playerId === playerId)?.ticketId
    return ticketId ? this.matchmaking.getTicket(ticketId) : null
  }

  private async activateAcceptedMatch(match: PvpAcceptedMatch): Promise<void> {
    await this.activateMatch(match)
  }

  private async activateMatch(match: {
    matchId: string
    mode: PvpMode
    region: string
    rulesetVersion: string
    acceptedAt: number
    players: Array<{ playerId: string; playerName: string; side: PvpSide; loadoutVersion: number }>
  }): Promise<void> {
    if (this.liveMatches.has(match.matchId)) return
    const runtime = new PvpMatchRuntime({
      matchId: match.matchId,
      mode: match.mode,
      seed: `${match.matchId}:${match.acceptedAt}`,
      rulesetVersion: match.rulesetVersion,
      tickRateMs: this.runtimeOptions.runtimeTickRateMs,
      countdownMs: this.runtimeOptions.countdownMs,
      roundIntervalMs: this.runtimeOptions.roundIntervalMs,
      disconnectForfeitMs: this.runtimeOptions.disconnectForfeitMs,
    })
    // Matchmaking accept/custom ready are explicit human actions; only that confirmed readiness is carried forward.
    // Asset loading is never acknowledged here: each browser must submit its own versioned load ACK.
    for (const player of match.players) runtime.registerParticipant(player.side, player, true)
    const live: LiveMatch = {
      runtime,
      mode: match.mode,
      region: match.region,
      seasonId: `season-1-${match.mode}`,
      createdAt: new Date(match.acceptedAt).toISOString(),
      participants: match.players.map(player => ({ ...player })),
      settling: false,
      settledDetail: null,
      settledAtMs: null,
      realtimeSeq: 1,
      realtimeConnections: new Map(),
      lease: null,
      checkpointSave: Promise.resolve(),
    }
    try {
      live.lease = await this.store.claimActiveMatchLease({ matchId: match.matchId, holderId: this.holderId, ttlMs: this.activeMatchLeaseTtlMs })
      this.liveMatches.set(match.matchId, live)
      await this.queueCheckpoint(live)
    } catch {
      throw new PvpPlatformError('PVP_LEASE_UNAVAILABLE', 'PVP 对局暂时无法取得权威租约', 503)
    }
  }

  private publishMatchState(matchId: string, live: LiveMatch): void {
    const subscribers = this.matchSubscribers.get(matchId)
    if (!subscribers?.size) return
    live.realtimeSeq += 1
    for (const subscriber of subscribers) subscriber.listener({
      kind: 'full', matchId, seq: live.realtimeSeq,
      state: live.runtime.projectForViewer(subscriber.playerId),
    })
  }

  private async settleIfNeeded(live: LiveMatch): Promise<void> {
    const authority = live.runtime.snapshot()
    if (live.settling || live.settledDetail || !authority.result || (authority.phase !== 'settling' && authority.phase !== 'voided')) return
    live.settling = true
    try {
      const endedAt = nowIso()
      const detail = await this.rank.settleMatch({
        requestId: `settle:${authority.matchId}`,
        matchId: authority.matchId,
        seasonId: live.seasonId,
        modeId: live.mode,
        modeVersion: MODE_VERSION,
        region: live.region,
        mapId: authority.mapId,
        mapVersion: String(authority.mapVersion),
        rulesetVersion: authority.rulesetVersion,
        catalogVersion: CATALOG_VERSION,
        effectSystemVersion: EFFECT_SYSTEM_VERSION,
        seed: authority.seed,
        winnerSide: this.winnerSide(authority),
        endReason: authority.result.reason,
        integrityStatus: authority.phase === 'voided' ? 'invalid' : 'valid',
        startedAt: live.createdAt,
        endedAt,
        participants: live.participants.map((participant, index) => ({
          playerId: participant.playerId,
          playerName: participant.playerName,
          side: participant.side,
          slot: index,
          loadoutSnapshotId: `pvp-loadout:${participant.playerId}:${participant.loadoutVersion}`,
          forfeited: authority.result?.reason === 'surrendered' && authority.result.loserPlayerId === participant.playerId,
          stats: authority.sides[participant.side]?.stats ?? {},
          reward: this.rewardFor(authority.result!.participants[participant.side], authority.tick * authority.tickRateMs),
        })) as [
          { playerId: string; playerName: string; side: PvpSide; slot: number; loadoutSnapshotId: string; forfeited: boolean; stats: Record<string, unknown>; reward: Record<string, unknown> },
          { playerId: string; playerName: string; side: PvpSide; slot: number; loadoutSnapshotId: string; forfeited: boolean; stats: Record<string, unknown>; reward: Record<string, unknown> },
        ],
      })
      live.settledDetail = detail
      live.settledAtMs = this.nowMs()
      if (authority.phase === 'settling') live.runtime.completeSettlement()
    }
    catch (error) {
      live.settling = false
      console.error(`PVP settlement failed for ${authority.matchId}:`, error)
      return
    }
    live.settling = false
  }

  private reapTerminalMatches(): void {
    const now = this.nowMs()
    // Waiting custom rooms are intentionally ephemeral.  A host can leave a
    // browser open for hours without creating an active match; reclaim those
    // indexes on the same cadence as terminal match retention.
    for (const [roomId, room] of this.customRooms) {
      if (room.matchId || now - room.createdAtMs < this.waitingRoomTtlMs) continue
      this.customRooms.delete(roomId)
      for (const key of this.roomPasswordAttempts.keys()) if (key.startsWith(`${roomId}:`)) this.roomPasswordAttempts.delete(key)
    }
    for (const [key, receipt] of this.customRoomReceipts) {
      if (now - receipt.createdAtMs >= this.waitingRoomTtlMs || !this.customRooms.has(receipt.roomId)) this.customRoomReceipts.delete(key)
    }
    const candidates = [...this.liveMatches.entries()]
      .filter(([matchId, live]) => live.settledDetail !== null
        && live.settledAtMs !== null
        && (this.matchSubscribers.get(matchId)?.size ?? 0) === 0
        && live.realtimeConnections.size === 0)
      .sort(([, left], [, right]) => (left.settledAtMs ?? 0) - (right.settledAtMs ?? 0))
    let retained = candidates.length
    for (const [matchId, live] of candidates) {
      const expired = now - live.settledAtMs! >= this.terminalRetentionMs
      const overCapacity = retained > this.maxRetainedTerminalMatches
      if (!expired && !overCapacity) continue
      this.liveMatches.delete(matchId)
      if (live.lease) void this.store.deleteActiveMatchCheckpoint(live.lease).catch(() => undefined)
      if ((this.matchSubscribers.get(matchId)?.size ?? 0) === 0) this.matchSubscribers.delete(matchId)
      for (const [roomId, room] of this.customRooms) {
        if (room.matchId !== matchId) continue
        this.customRooms.delete(roomId)
        for (const key of this.roomPasswordAttempts.keys()) if (key.startsWith(`${roomId}:`)) this.roomPasswordAttempts.delete(key)
      }
      retained -= 1
    }
  }

  private rewardFor(result: 'win' | 'loss' | 'draw' | 'void', durationMs: number): Record<string, unknown> {
    if (result === 'void' || durationMs < 30_000) return {}
    if (result === 'win') return { honor: 20, gold: 10 }
    if (result === 'draw') return { honor: 12, gold: 6 }
    return { honor: 8, gold: 5 }
  }

  private winnerSide(authority: PvpAuthorityState): PvpSide | null {
    const winnerId = authority.result?.winnerPlayerId
    if (!winnerId) return null
    return authority.sides.A?.playerId === winnerId ? 'A' : authority.sides.B?.playerId === winnerId ? 'B' : null
  }

  private requireLiveMatchForPlayer(matchId: string, playerId: string): LiveMatch {
    const live = this.liveMatches.get(matchId)
    if (!live) throw new PvpPlatformError('MATCH_NOT_FOUND', 'PVP 对局不存在', 404)
    this.assertParticipant(live.participants.map(player => player.playerId), playerId)
    return live
  }

  private assertNoActiveMatch(playerId: string): void {
    const active = [...this.liveMatches.values()].find((live) => !live.runtime.isQuiescent()
      && live.participants.some((participant) => participant.playerId === playerId))
    if (active) throw new PvpPlatformError('ALREADY_IN_MATCH', '当前账号已在 PVP 对局中', 409)
  }

  private assertParticipant(playerIds: string[], playerId: string): void {
    if (!playerIds.includes(playerId)) throw new PvpPlatformError('MATCH_ACCESS_DENIED', '只有对局参与者可以访问当前状态', 403)
  }

  private customRoomPlayer(principal: HumanGatewayPrincipal, side: PvpSide, isHost: boolean): PvpCustomRoomPlayer {
    return {
      playerId: principal.playerId,
      playerName: principal.playerName,
      side,
      ready: false,
      connected: true,
      isHost,
      tier: 'unranked',
      division: null,
    }
  }

  private requireRoom(roomId: string): CustomRoomRuntime {
    const room = this.customRooms.get(roomId)
    if (!room) throw new PvpPlatformError('ROOM_NOT_FOUND', 'PVP 房间不存在', 404)
    return room
  }

  private projectRoom(room: CustomRoomRuntime): PvpCustomRoomProjection {
    const phase = room.matchId ? this.liveMatches.get(room.matchId)?.runtime.snapshot().phase ?? 'loading' : 'waiting_players'
    return {
      roomId: room.roomId,
      roomName: room.roomName,
      mode: 'custom_1v1',
      status: phase,
      mapId: DUAL_REALM_MAP.mapId,
      mapName: MAP_NAME,
      hasPassword: room.passwordCredential !== null,
      spectatorsAllowed: room.spectatorsAllowed,
      playerCount: room.players.length,
      maxPlayers: 2,
      players: structuredClone(room.players),
      createdAt: room.createdAt,
      matchId: room.matchId,
    }
  }
}
