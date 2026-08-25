import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl, resolveGatewayToken, resolvePlayerId } from '../lib/runtime-config'
import type {
  PvpLeaderboard,
  PvpMatchDetail,
  PvpMatchPublicState,
  PvpMatchSummary,
  PvpMode,
  PvpAcceptedMatch,
  PvpMatchFound,
  PvpOverviewData,
  PvpProfile,
  PvpQueueTicket,
  PvpRoomSummary,
  PvpSeason,
  PvpTier,
} from '../types/pvp'
import type { PvpBoardPieceState, PvpCommandResult, PvpEnemyState, PvpRecruitState, PvpRulesSnapshot, PvpRuntimeEvent } from '../../shared/contracts/pvp'
import { classifyPvpSequence, consumePvpSseBuffer, shouldRequestPvpFullRecovery } from '../game/network/pvp-realtime'

interface UsePvpDataOptions {
  matchId?: string
  roomId?: string
}

interface ApiEnvelope {
  ok?: boolean
  [key: string]: unknown
}

class PvpApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PvpApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrap<T>(payload: unknown, keys: string[]): T | null {
  if (!isRecord(payload)) return null
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) return payload[key] as T
  }
  return payload as T
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : null
}

function readString(value: Record<string, unknown> | null, ...keys: string[]) {
  for (const key of keys) if (typeof value?.[key] === 'string') return value[key] as string
  return ''
}

function readNumber(value: Record<string, unknown> | null, ...keys: string[]) {
  for (const key of keys) if (typeof value?.[key] === 'number' && Number.isFinite(value[key])) return value[key] as number
  return 0
}

function tierLabel(value: unknown): PvpTier {
  const labels: Record<string, PvpTier> = {
    unranked: '未定级', black_iron: '玄铁', bronze: '青铜', silver: '白银', gold: '黄金',
    amethyst: '紫金', great_sage: '大圣', victorious_fighting_buddha: '斗战胜佛',
    未定级: '未定级', 玄铁: '玄铁', 青铜: '青铜', 白银: '白银', 黄金: '黄金', 紫金: '紫金', 大圣: '大圣', 斗战胜佛: '斗战胜佛',
  }
  return typeof value === 'string' ? labels[value] ?? '未定级' : '未定级'
}

function divisionLabel(value: unknown) {
  if (typeof value === 'string') return value || null
  if (value === 1) return 'I'
  if (value === 2) return 'II'
  if (value === 3) return 'III'
  return null
}

function outcomeLabel(value: unknown): PvpMatchSummary['result'] {
  if (value === 'win' || value === 'loss' || value === 'draw') return value
  return 'void'
}

function normalizeSeason(payload: unknown): PvpSeason | null {
  const value = asRecord(unwrap<unknown>(payload, ['season']))
  if (!value) return null
  const rawStatus = readString(value, 'status')
  const status: PvpSeason['status'] = rawStatus === 'scheduled' ? 'upcoming' : rawStatus === 'locked' ? 'settling' : rawStatus === 'archived' ? 'completed' : rawStatus === 'active' ? 'active' : 'active'
  const mapIds = Array.isArray(value.mapIds) ? value.mapIds.filter((entry): entry is string => typeof entry === 'string') : ['pvp_dual_realm_v1']
  return {
    seasonId: readString(value, 'seasonId'),
    name: readString(value, 'name') || '当前赛季',
    status,
    startsAt: readString(value, 'startsAt'),
    endsAt: readString(value, 'endsAt', 'locksAt'),
    rulesetVersion: readString(value, 'rulesetVersion', 'rankPolicyVersion') || 'current',
    mapIds,
  }
}

function normalizeProfile(payload: unknown): PvpProfile | null {
  const root = asRecord(payload)
  const value = asRecord(unwrap<unknown>(payload, ['profile']))
  if (!value) return null
  const rating = asRecord(value.rating) ?? asRecord(root?.rating)
  const games = readNumber(rating, 'games')
  return {
    playerId: readString(value, 'playerId'),
    playerName: readString(value, 'playerName', 'name') || '真人玩家',
    avatarUrl: readString(value, 'avatarUrl', 'avatar') || null,
    tutorialCompleted: value.tutorialCompleted === true,
    loadoutValid: value.loadoutValid === true,
    queuePenaltyUntil: readString(value, 'queuePenaltyUntil') || null,
    region: readString(value, 'region') || '自动区域',
    rating: {
      tier: tierLabel(rating?.tier), division: divisionLabel(rating?.division),
      visibleLp: readNumber(rating, 'visibleLp', 'leaguePoints'), rating: readNumber(rating, 'rating'),
      wins: readNumber(rating, 'wins'), losses: readNumber(rating, 'losses'), draws: readNumber(rating, 'draws'),
      streak: readNumber(rating, 'streak'), placementGames: readNumber(rating, 'placementGames', 'provisionalGames'),
      peakLp: readNumber(rating, 'peakLp') || readNumber(rating, 'leaguePoints'), rank: typeof rating?.rank === 'number' ? rating.rank : null,
    },
    recentMatchIds: Array.isArray(value.recentMatchIds) ? value.recentMatchIds.filter((entry): entry is string => typeof entry === 'string') : games ? [] : [],
  }
}

function normalizeLeaderboard(payload: unknown): PvpLeaderboard | null {
  const value = asRecord(unwrap<unknown>(payload, ['leaderboard']))
  if (!value) return null
  const rawEntries = Array.isArray(value.entries) ? value.entries : []
  const entries = rawEntries.flatMap((raw) => {
    const entry = asRecord(raw)
    if (!entry || !readString(entry, 'playerId')) return []
    const wins = readNumber(entry, 'wins'); const losses = readNumber(entry, 'losses'); const draws = readNumber(entry, 'draws')
    const games = readNumber(entry, 'games') || wins + losses + draws
    return [{
      rank: readNumber(entry, 'rank'), playerId: readString(entry, 'playerId'), playerName: readString(entry, 'playerName') || '真人玩家',
      avatarUrl: readString(entry, 'avatarUrl') || null, tier: tierLabel(entry.tier), division: divisionLabel(entry.division),
      visibleLp: readNumber(entry, 'visibleLp', 'leaguePoints'), rating: readNumber(entry, 'rating'), wins, losses, draws,
      winRate: typeof entry.winRate === 'number' ? entry.winRate : games ? wins / games : 0,
      reachedAt: readString(entry, 'reachedAt', 'tierReachedAt', 'updatedAt'),
    }]
  })
  const selfRecord = asRecord(value.self)
  const self = selfRecord ? normalizeLeaderboard({ leaderboard: { entries: [selfRecord] } })?.entries[0] ?? null : null
  return { seasonId: readString(value, 'seasonId'), scope: value.scope === 'friends' || value.scope === 'region' ? value.scope : 'global', entries, self, nextCursor: readString(value, 'nextCursor') || null }
}

function normalizeHistory(payload: unknown): PvpMatchSummary[] {
  const value = unwrap<unknown>(payload, ['matches', 'history'])
  const list = Array.isArray(value) ? value : Array.isArray(asRecord(value)?.entries) ? asRecord(value)!.entries as unknown[] : []
  return list.flatMap((raw) => {
    const entry = asRecord(raw)
    const match = asRecord(entry?.match) ?? entry
    const self = asRecord(entry?.self)
    const opponents = Array.isArray(entry?.opponents) ? entry.opponents.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : []
    const matchId = readString(match, 'matchId')
    if (!matchId) return []
    const result = outcomeLabel(self?.outcome ?? match?.result)
    return [{
      matchId, seasonId: readString(match, 'seasonId'), mode: (readString(match, 'mode', 'modeId') || 'ranked_1v1') as PvpMode,
      mapId: readString(match, 'mapId') || 'pvp_dual_realm_v1', mapName: readString(match, 'mapName') || '两界斗法台',
      status: (readString(match, 'phase', 'status') === 'no_contest' ? 'voided' : 'completed') as PvpMatchSummary['status'], result,
      resultReason: readString(match, 'resultReason', 'endReason'), opponentPlayerId: readString(opponents[0] ?? null, 'playerId') || null,
      opponentName: readString(opponents[0] ?? null, 'playerName'), startedAt: readString(match, 'startedAt'), endedAt: readString(match, 'endedAt') || null,
      durationMs: readNumber(match, 'durationMs'), lpDelta: readNumber(self, 'lpDelta', 'leaguePointsDelta'),
      replayAvailable: entry?.replayAvailable === true || match?.replayStatus === 'available',
    }]
  })
}

function normalizeMatchDetail(payload: unknown): PvpMatchDetail | null {
  const detail = asRecord(unwrap<unknown>(payload, ['detail'])) ?? asRecord(payload)
  const match = asRecord(detail?.match) ?? asRecord(unwrap<unknown>(payload, ['match']))
  if (!match || !readString(match, 'matchId')) return null
  const participantsRaw = Array.isArray(detail?.participants) ? detail.participants : Array.isArray(match.participants) ? match.participants : []
  const participants = participantsRaw.flatMap((raw) => {
    const participant = asRecord(raw)
    if (!participant) return []
    const stats = asRecord(participant.stats)
    return [{
      playerId: readString(participant, 'playerId'), playerName: readString(participant, 'playerName') || '真人玩家', side: participant.side === 'B' ? 'B' as const : 'A' as const,
      result: outcomeLabel(participant.result ?? participant.outcome), coreHpRemaining: readNumber(stats, 'coreHpRemaining'), baseKills: readNumber(stats, 'baseKills'),
      pressureKills: readNumber(stats, 'pressureKills'), leaks: readNumber(stats, 'leaks'), scriptureEarned: readNumber(stats, 'scriptureEarned'),
      scriptureSpent: readNumber(stats, 'scriptureSpent'), pressureSent: readNumber(stats, 'pressureSent'), pressureLeaked: readNumber(stats, 'pressureLeaked'),
      rationsEarned: readNumber(stats, 'rationsEarned'), rationsSpent: readNumber(stats, 'rationsSpent'), paidRecruitCount: readNumber(stats, 'paidRecruitCount'),
      activeGeneralIds: Array.isArray(stats?.activeGeneralIds) ? stats.activeGeneralIds.filter((item): item is string => typeof item === 'string') : [],
      peakPopulation: readNumber(stats, 'peakPopulation'), highestSoldierLevel: readNumber(stats, 'highestSoldierLevel'), damageDealt: readNumber(stats, 'damageDealt'),
      controlDurationMs: readNumber(stats, 'controlDurationMs'), tierBefore: tierLabel(participant.tierBefore), tierAfter: tierLabel(participant.tierAfter),
      lpBefore: readNumber(participant, 'lpBefore', 'leaguePointsBefore'), lpAfter: readNumber(participant, 'lpAfter', 'leaguePointsAfter'),
    }]
  })
  const selfId = resolvePlayerId()
  const self = participantsRaw.map(asRecord).find((participant) => readString(participant, 'playerId') === selfId) ?? asRecord(participantsRaw[0])
  const settlements = Array.isArray(detail?.settlements) ? detail.settlements.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : []
  const selfSettlement = settlements.find((settlement) => readString(settlement, 'playerId') === selfId) ?? settlements[0]
  const result = outcomeLabel(self?.outcome ?? match.result)
  const rewardRecord = asRecord(selfSettlement?.reward)
  const rewards = rewardRecord ? Object.entries(rewardRecord).flatMap(([type, amount]) => typeof amount === 'number' ? [{ type, amount, label: type === 'gold' ? '金币' : type === 'honor' ? '荣誉' : type }] : []) : []
  return {
    matchId: readString(match, 'matchId'), seasonId: readString(match, 'seasonId'), mode: (readString(match, 'mode', 'modeId') || 'ranked_1v1') as PvpMode,
    mapId: readString(match, 'mapId') || 'pvp_dual_realm_v1', mapName: readString(match, 'mapName') || '两界斗法台', status: readString(match, 'status') === 'no_contest' ? 'voided' : 'completed',
    result, resultReason: readString(match, 'resultReason', 'endReason'), opponentPlayerId: null, opponentName: '', startedAt: readString(match, 'startedAt'), endedAt: readString(match, 'endedAt') || null,
    durationMs: readNumber(match, 'durationMs'), lpDelta: readNumber(selfSettlement ?? self, 'leaguePointsDelta', 'lpDelta'), replayAvailable: detail?.replayAvailable === true,
    mapVersion: readString(match, 'mapVersion'), rulesetVersion: readString(match, 'rulesetVersion'), winnerPlayerId: readString(match, 'winnerPlayerId') || null,
    participants, rewards, replayStatus: (readString(detail, 'replayStatus') || (detail?.replayAvailable ? 'available' : 'unavailable')) as PvpMatchDetail['replayStatus'],
  }
}

function normalizeGameState(payload: unknown): PvpMatchPublicState | null {
  const envelope = asRecord(payload)
  const value = asRecord(unwrap<unknown>(payload, ['state', 'gameState']))
  if (!value || !readString(value, 'matchId')) return null
  if (isRecord(value.self) && isRecord(value.opponent)) return value as unknown as PvpMatchPublicState
  const sides = asRecord(value.sides)
  const sideA = asRecord(sides?.A); const sideB = asRecord(sides?.B)
  const viewerPlayerId = readString(value, 'viewerPlayerId') || resolvePlayerId()
  const selfSide = readString(sideA, 'playerId') === viewerPlayerId || sideA?.privateState ? sideA : sideB
  const opponentSide = selfSide === sideA ? sideB : sideA
  const round = asRecord(value.round); const tribulation = asRecord(value.tribulation); const loading = asRecord(value.loading)
  const privateState = asRecord(selfSide?.privateState)
  const recentEvents = Array.isArray(value.recentEvents) ? value.recentEvents.map(asRecord).filter((event): event is Record<string, unknown> => event !== null) : []
  return {
    matchId: readString(value, 'matchId'), status: (readString(value, 'phase', 'status') || 'waiting_players') as PvpMatchPublicState['status'],
    mapId: readString(value, 'mapId'), mapVersion: String(value.mapVersion ?? ''), rulesetVersion: readString(value, 'rulesetVersion'),
    elapsedMs: readNumber(value, 'elapsedMs') || readNumber(value, 'tick') * readNumber(value, 'tickRateMs'),
    tick: readNumber(value, 'tick'), tickRateMs: readNumber(value, 'tickRateMs'), realtimeSeq: readNumber(envelope, 'seq'),
    rulesSnapshot: value.rulesSnapshot as PvpRulesSnapshot,
    round: readNumber(round, 'number'), disasterLevel: readNumber(tribulation, 'tier'),
    loading: {
      rulesetVersion: readString(loading, 'rulesetVersion'), mapId: readString(loading, 'mapId'), mapVersion: readNumber(loading, 'mapVersion'),
      routeHash: readString(loading, 'routeHash'), assetsVersion: readString(loading, 'assetsVersion'),
      remainingMs: readNumber(loading, 'remainingTicks') * readNumber(value, 'tickRateMs'),
    },
    self: { side: readString(selfSide, 'side') === 'B' ? 'B' : 'A', playerId: readString(selfSide, 'playerId'), playerName: readString(selfSide, 'playerName') || '我方', coreHp: readNumber(selfSide, 'coreHp'), rations: readNumber(selfSide, 'rations'), scripture: readNumber(selfSide, 'scripture'), connected: selfSide?.connected !== false, loadStatus: readString(selfSide, 'loadStatus') || (selfSide?.loaded ? 'loaded' : 'idle'), loadFailureCode: readString(selfSide, 'loadFailureCode') || null, populationUsed: readNumber(selfSide, 'populationUsed'), populationCap: readNumber(selfSide, 'populationCap'), boardPieces: (Array.isArray(selfSide?.boardPieces) ? selfSide.boardPieces : []) as PvpBoardPieceState[], enemies: (Array.isArray(selfSide?.enemies) ? selfSide.enemies : []) as PvpEnemyState[], tray: (Array.isArray(privateState?.tray) ? privateState.tray : []) as Array<PvpRecruitState | null>, reserve: (Array.isArray(privateState?.reserve) ? privateState.reserve : []) as Array<PvpRecruitState | null>, trayRevision: readNumber(privateState, 'trayRevision'), boardRevision: readNumber(privateState, 'boardRevision') },
    opponent: { side: readString(opponentSide, 'side') === 'A' ? 'A' : 'B', playerId: readString(opponentSide, 'playerId'), playerName: readString(opponentSide, 'playerName') || '对手', coreHp: readNumber(opponentSide, 'coreHp'), connected: opponentSide?.connected !== false, loadStatus: readString(opponentSide, 'loadStatus') || (opponentSide?.loaded ? 'loaded' : 'idle'), populationUsed: readNumber(opponentSide, 'populationUsed'), boardPieces: (Array.isArray(opponentSide?.boardPieces) ? opponentSide.boardPieces : []) as PvpBoardPieceState[], enemies: (Array.isArray(opponentSide?.enemies) ? opponentSide.enemies : []) as PvpEnemyState[] },
    recentEvents: recentEvents as unknown as PvpRuntimeEvent[],
    notices: recentEvents.slice(-6).map((event) => readString(event, 'type')).filter(Boolean),
  }
}

function normalizeRoom(value: unknown): PvpRoomSummary | null {
  const room = asRecord(value)
  if (!room || !readString(room, 'roomId')) return null
  const players = Array.isArray(room.players) ? room.players.flatMap((raw) => {
    const player = asRecord(raw)
    if (!player || !readString(player, 'playerId')) return []
    return [{
      playerId: readString(player, 'playerId'), playerName: readString(player, 'playerName'), side: player.side === 'A' ? 'A' as const : player.side === 'B' ? 'B' as const : null,
      ready: player.ready === true, connected: player.connected !== false, isHost: player.isHost === true,
      tier: tierLabel(player.tier), division: divisionLabel(player.division),
    }]
  }) : []
  return {
    roomId: readString(room, 'roomId'), roomName: readString(room, 'roomName'), mode: 'custom_1v1',
    status: (readString(room, 'status') || 'waiting_players') as PvpRoomSummary['status'], mapId: readString(room, 'mapId') || 'pvp_dual_realm_v1',
    mapName: readString(room, 'mapName') || '两界斗法台', hasPassword: room.hasPassword === true, spectatorsAllowed: room.spectatorsAllowed === true,
    playerCount: readNumber(room, 'playerCount') || players.length, maxPlayers: readNumber(room, 'maxPlayers') || 2,
    players, createdAt: readString(room, 'createdAt'), matchId: readString(room, 'matchId') || null,
  }
}

function normalizeRooms(payload: unknown) {
  const rooms = unwrap<unknown>(payload, ['rooms'])
  return Array.isArray(rooms) ? rooms.map(normalizeRoom).filter((room): room is PvpRoomSummary => room !== null) : []
}

async function requestJson<T>(url: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  const payload = await response.json().catch(() => null) as ApiEnvelope | null
  if (!response.ok || payload?.ok === false) {
    const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`
    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : code
    throw new PvpApiError(code, message)
  }
  return payload as T
}

async function consumeSse(response: Response, onData: (payload: unknown) => void, signal: AbortSignal) {
  if (!response.ok || !response.body) throw new Error(`PVP_REALTIME_HTTP_${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = consumePvpSseBuffer(buffer)
    buffer = parsed.remainder
    parsed.payloads.forEach(onData)
  }
}

export function usePvpData(options: UsePvpDataOptions = {}) {
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), [])
  const token = useMemo(() => resolveGatewayToken(), [])
  const [data, setData] = useState<PvpOverviewData>({ profile: null, season: null, leaderboard: null, history: [], rooms: [] })
  const [match, setMatch] = useState<PvpMatchDetail | null>(null)
  const [room, setRoom] = useState<PvpRoomSummary | null>(null)
  const [gameState, setGameState] = useState<PvpMatchPublicState | null>(null)
  const [queueTicket, setQueueTicket] = useState<PvpQueueTicket | null>(null)
  const [matchProposal, setMatchProposal] = useState<PvpMatchFound | null>(null)
  const [acceptedMatch, setAcceptedMatch] = useState<PvpAcceptedMatch | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pressureMessage, setPressureMessage] = useState<string | null>(null)
  const [battleActionMessage, setBattleActionMessage] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<'idle' | 'connecting' | 'live' | 'fallback'>('idle')
  const [loadAckStatus, setLoadAckStatus] = useState<'idle' | 'preloading' | 'acknowledged' | 'failed'>('idle')

  const endpoint = useCallback((path: string) => apiBaseUrl ? `${apiBaseUrl}/pvp${path}` : null, [apiBaseUrl])

  const refresh = useCallback(async () => {
    if (!apiBaseUrl) {
      setError('PVP API 地址尚未配置。')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    const tasks = [
      requestJson<unknown>(`${apiBaseUrl}/pvp/profile`, token).then((payload) => ({ key: 'profile' as const, value: normalizeProfile(payload) })),
      requestJson<unknown>(`${apiBaseUrl}/pvp/seasons/current`, token).then((payload) => ({ key: 'season' as const, value: normalizeSeason(payload) })),
      requestJson<unknown>(`${apiBaseUrl}/pvp/leaderboard?scope=global&limit=50`, token).then((payload) => ({ key: 'leaderboard' as const, value: normalizeLeaderboard(payload) })),
      requestJson<unknown>(`${apiBaseUrl}/pvp/matches?limit=20`, token).then((payload) => ({ key: 'history' as const, value: normalizeHistory(payload) })),
      requestJson<unknown>(`${apiBaseUrl}/pvp/rooms`, token).then((payload) => ({ key: 'rooms' as const, value: normalizeRooms(payload) })),
    ]
    const results = await Promise.allSettled(tasks)
    const next: PvpOverviewData = { profile: null, season: null, leaderboard: null, history: [], rooms: [] }
    let firstError: string | null = null
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.key === 'profile') next.profile = result.value.value
        if (result.value.key === 'season') next.season = result.value.value
        if (result.value.key === 'leaderboard') next.leaderboard = result.value.value
        if (result.value.key === 'history') next.history = result.value.value
        if (result.value.key === 'rooms') next.rooms = result.value.value
      } else if (!firstError) {
        firstError = result.reason instanceof Error ? result.reason.message : 'PVP 服务尚未装配。'
      }
    }
    setData(next)
    setError(firstError)
    setIsLoading(false)
  }, [apiBaseUrl, token])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!queueTicket || !apiBaseUrl || queueTicket.state === 'cancelled' || queueTicket.state === 'expired' || acceptedMatch) return
    let active = true
    const refreshTicket = async () => {
      try {
        const payload = await requestJson<unknown>(`${apiBaseUrl}/pvp/queue/${encodeURIComponent(queueTicket.ticketId)}`, token)
        if (!active) return
        const nextTicket = unwrap<PvpQueueTicket>(payload, ['ticket', 'queueTicket'])
        const nextProposal = unwrap<PvpMatchFound>(payload, ['proposal', 'matchFound'])
        const nextMatch = unwrap<PvpAcceptedMatch>(payload, ['match', 'acceptedMatch'])
        if (nextTicket) setQueueTicket(nextTicket)
        if (nextProposal?.proposalId) setMatchProposal(nextProposal)
        if (nextMatch?.matchId) setAcceptedMatch(nextMatch)
      } catch {
        // 匹配页保留最近一次已确认状态；全局错误不因短轮询抖动反复闪烁。
      }
    }
    void refreshTicket()
    const timer = window.setInterval(() => void refreshTicket(), 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [acceptedMatch, apiBaseUrl, queueTicket?.state, queueTicket?.ticketId, token])

  useEffect(() => {
    if (!options.matchId || !apiBaseUrl) {
      setMatch(null)
      setGameState(null)
      return
    }
    const controller = new AbortController()
    void requestJson<unknown>(`${apiBaseUrl}/pvp/matches/${encodeURIComponent(options.matchId)}`, token, { signal: controller.signal })
      .then((payload) => setMatch(normalizeMatchDetail(payload)))
      .catch(() => {})
    return () => controller.abort()
  }, [apiBaseUrl, options.matchId, token])

  useEffect(() => {
    if (!options.matchId || !apiBaseUrl) return
    let active = true
    let reconnectTimer: number | null = null
    let controller: AbortController | null = null
    let lastSeq = 0
    let fullRefreshInFlight: Promise<void> | null = null
    let gapRecoveryPending = false
    let lastGapRecoveryAt = Number.NEGATIVE_INFINITY
    const refreshFull = (reason: 'initial' | 'gap' | 'stream_end' | 'stream_error' | 'visibility'): Promise<void> => {
      const now = performance.now()
      if (reason === 'gap' && !shouldRequestPvpFullRecovery(gapRecoveryPending, lastGapRecoveryAt, now)) return Promise.resolve()
      if (fullRefreshInFlight) return fullRefreshInFlight
      if (reason === 'gap') { gapRecoveryPending = true; lastGapRecoveryAt = now }
      fullRefreshInFlight = (async () => {
        try {
          const payload = await requestJson<unknown>(`${apiBaseUrl}/pvp/matches/${encodeURIComponent(options.matchId!)}/state`, token, {
            headers: { 'X-PVP-Recovery': reason },
          })
          if (!active) return
          const next = normalizeGameState(payload)
          if (next) setGameState(next)
        } catch {
          if (active) setRealtimeStatus('fallback')
        } finally {
          if (reason === 'gap') gapRecoveryPending = false
          fullRefreshInFlight = null
        }
      })()
      return fullRefreshInFlight
    }
    const connect = async () => {
      if (!active || document.visibilityState === 'hidden') return
      controller?.abort()
      const streamController = new AbortController()
      controller = streamController
      setRealtimeStatus('connecting')
      try {
        const headers = new Headers({ Accept: 'text/event-stream' })
        if (token) headers.set('Authorization', `Bearer ${token}`)
        const response = await fetch(`${apiBaseUrl}/pvp/matches/${encodeURIComponent(options.matchId!)}/events`, { headers, signal: streamController.signal })
        setRealtimeStatus('live')
        await consumeSse(response, (payload) => {
          const root = asRecord(payload)
          const seq = readNumber(root, 'seq')
          const sequenceDecision = classifyPvpSequence(lastSeq, seq)
          if (sequenceDecision === 'stale') return
          if (sequenceDecision === 'gap') void refreshFull('gap')
          const next = normalizeGameState(payload)
          if (next) setGameState(next)
          lastSeq = seq
        }, streamController.signal)
        if (active && !document.hidden) {
          setRealtimeStatus('fallback')
          await refreshFull('stream_end')
          reconnectTimer = window.setTimeout(() => void connect(), 1_000)
        }
      } catch (streamError) {
        if (!active || streamController.signal.aborted) return
        setRealtimeStatus('fallback')
        await refreshFull('stream_error')
        reconnectTimer = window.setTimeout(() => void connect(), 1_000)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { controller?.abort(); setRealtimeStatus('idle') }
      else { void refreshFull('visibility'); void connect() }
    }
    void refreshFull('initial')
    void connect()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      controller?.abort()
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [apiBaseUrl, options.matchId, token])

  useEffect(() => {
    if (!options.matchId || !apiBaseUrl || !gameState || gameState.status !== 'loading'
      || gameState.self.loadStatus === 'loaded' || loadAckStatus === 'preloading' || loadAckStatus === 'acknowledged'
      || loadAckStatus === 'failed') return
    let cancelled = false
    const acknowledge = async () => {
      setLoadAckStatus('preloading')
      const requestKey = `pvp-load-ack:${options.matchId}`
      const requestId = sessionStorage.getItem(requestKey) ?? crypto.randomUUID()
      sessionStorage.setItem(requestKey, requestId)
      try {
        if (!gameState.loading.rulesetVersion || !gameState.loading.routeHash || gameState.loading.assetsVersion !== 'pvp_assets_v1') {
          throw new Error('PVP_LOAD_MANIFEST_MISMATCH')
        }
        await document.fonts?.ready
        if (cancelled) return
        const result = await requestJson<PvpCommandResult>(`${apiBaseUrl}/pvp/matches/${encodeURIComponent(options.matchId!)}/load-ack`, token, {
          method: 'POST', body: JSON.stringify({ requestId, status: 'loaded', ...gameState.loading }),
        })
        if (!result.ok) throw new Error(result.code)
        setLoadAckStatus('acknowledged')
      } catch (loadError) {
        if (cancelled) return
        const failureCode = loadError instanceof Error ? loadError.message : 'PVP_CLIENT_LOAD_FAILED'
        await requestJson(`${apiBaseUrl}/pvp/matches/${encodeURIComponent(options.matchId!)}/load-ack`, token, {
          method: 'POST', body: JSON.stringify({ requestId: `${requestId}:failed`, status: 'failed', ...gameState.loading, failureCode }),
        }).catch(() => null)
        setLoadAckStatus('failed')
        setError(failureCode)
      }
    }
    void acknowledge()
    return () => { cancelled = true }
  }, [apiBaseUrl, gameState, loadAckStatus, options.matchId, token])

  useEffect(() => {
    if (!options.roomId || !apiBaseUrl) {
      setRoom(null)
      return
    }
    let active = true
    let timer: number | null = null
    const poll = async () => {
      try {
        const payload = await requestJson<unknown>(`${apiBaseUrl}/pvp/rooms/${encodeURIComponent(options.roomId!)}`, token)
        if (!active) return
        const next = normalizeRoom(unwrap<unknown>(payload, ['room']))
        if (next) {
          setRoom(next)
          if (next.matchId) return
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : '读取 PVP 房间失败。')
      }
      if (active) timer = window.setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => { active = false; if (timer !== null) window.clearTimeout(timer) }
  }, [apiBaseUrl, options.roomId, token])

  const mutate = useCallback(async <T,>(path: string, method: string, body?: Record<string, unknown>, keys: string[] = []): Promise<T | null> => {
    const url = endpoint(path)
    if (!url) throw new Error('PVP API 地址尚未配置。')
    setIsMutating(true)
    setError(null)
    setNotice(null)
    try {
      const payload = await requestJson<unknown>(url, token, {
        method,
        body: body ? JSON.stringify({ ...body, requestId: typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID() }) : undefined,
      })
      return keys.length ? unwrap<T>(payload, keys) : payload as T
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'PVP 操作失败。'
      setError(message)
      throw requestError
    } finally {
      setIsMutating(false)
    }
  }, [endpoint, token])

  const joinQueue = useCallback(async (mode: Extract<PvpMode, 'ranked_1v1' | 'casual_1v1'>) => {
    const response = await mutate<{ ticket?: PvpQueueTicket; proposal?: PvpMatchFound }>('/queue', 'POST', {
      mode,
      region: 'auto',
      rulesetVersion: data.season?.rulesetVersion ?? 'current',
      loadoutVersion: 0,
    })
    const ticket = response?.ticket ?? (response as unknown as PvpQueueTicket | null)
    setQueueTicket(ticket)
    setMatchProposal(response?.proposal ?? ticket?.proposal ?? null)
    if (ticket) setNotice(mode === 'ranked_1v1' ? '已进入排位匹配队列。' : '已进入休闲匹配队列。')
    return ticket
  }, [data.season?.rulesetVersion, mutate])

  const cancelQueue = useCallback(async () => {
    if (!queueTicket) return
    await mutate(`/queue/${encodeURIComponent(queueTicket.ticketId)}`, 'DELETE', {})
    setQueueTicket(null)
    setMatchProposal(null)
    setAcceptedMatch(null)
    setNotice('已取消匹配。')
  }, [mutate, queueTicket])

  const acceptMatch = useCallback(async () => {
    const proposalId = matchProposal?.proposalId ?? queueTicket?.proposalId
    if (!proposalId) return null
    const response = await mutate<{ ticket?: PvpQueueTicket; proposal?: PvpMatchFound; match?: PvpAcceptedMatch; acceptedMatch?: PvpAcceptedMatch }>(`/proposals/${encodeURIComponent(proposalId)}/accept`, 'POST', {})
    const ticket = response?.ticket ?? null
    const proposal = response?.proposal ?? matchProposal
    const match = response?.match ?? response?.acceptedMatch ?? null
    if (ticket) {
      setQueueTicket(ticket)
    } else if (queueTicket) {
      setQueueTicket({ ...queueTicket, state: match ? 'accepted' : 'match_found' })
    }
    setMatchProposal(proposal)
    setAcceptedMatch(match)
    setNotice('已确认对局，等待对手与地图加载。')
    return match
  }, [matchProposal, mutate, queueTicket])

  const createRoom = useCallback(async (input: { roomName: string; password: string; spectatorsAllowed: boolean }) => {
    const raw = await mutate<unknown>('/rooms', 'POST', input, ['room'])
    const created = normalizeRoom(raw)
    if (created) {
      setRoom(created)
      setNotice('自定义斗法房创建成功。')
      void refresh()
    }
    return created
  }, [mutate, refresh])

  const joinRoom = useCallback(async (roomId: string, password: string) => {
    const raw = await mutate<unknown>(`/rooms/${encodeURIComponent(roomId)}/join`, 'POST', { password }, ['room'])
    const joined = normalizeRoom(raw)
    if (joined) { setRoom(joined); setNotice('已加入自定义斗法房。') }
    return joined
  }, [mutate])

  const setReady = useCallback(async (roomId: string, ready: boolean) => {
    const raw = await mutate<unknown>(`/rooms/${encodeURIComponent(roomId)}/ready`, 'POST', { ready }, ['room'])
    const updated = normalizeRoom(raw)
    if (updated) setRoom(updated)
    return updated
  }, [mutate])

  const surrender = useCallback(async (matchId: string) => {
    await mutate(`/matches/${encodeURIComponent(matchId)}/surrender`, 'POST', {})
    setNotice('投降请求已提交，以服务器权威结果为准。')
  }, [mutate])

  const sendPressure = useCallback(async (matchId: string) => {
    setPressureMessage(null)
    try {
      const result = await mutate<PvpCommandResult>(`/matches/${encodeURIComponent(matchId)}/pressure`, 'POST', {})
      if (result?.ok) {
        setPressureMessage('遣妖已进入对手的安全生成队列。')
        return result
      }
      setPressureMessage(`遣妖被拒绝：${result?.code ?? 'UNKNOWN'}`)
      return result
    } catch (requestError) {
      const code = requestError instanceof PvpApiError ? requestError.code : 'UNKNOWN'
      const labels: Record<string, string> = {
        INSUFFICIENT_SCRIPTURE: '真经不足，需要 5 点真经。', PRESSURE_COOLDOWN: '遣妖冷却中，请稍后再试。',
        PRESSURE_QUEUE_FULL: '对手的压力生成队列已满。', MATCH_NOT_PLAYING: '当前对局不在可发送压力的阶段。',
        WRONG_PHASE: '当前对局不在可发送压力的阶段。', PLAYER_NOT_FOUND: '你不是该对局的参与者。',
        OPPONENT_NOT_FOUND: '对手尚未进入战场。', MATCH_ACCESS_DENIED: '你不是该对局的参与者。', MATCH_NOT_FOUND: '对局不存在或已经回收。',
      }
      setPressureMessage(`遣妖被拒绝：${labels[code] ?? (requestError instanceof Error ? requestError.message : code)}`)
      setError(null)
      return null
    }
  }, [mutate])

  const resyncBattle = useCallback(async (matchId: string) => {
    if (!apiBaseUrl) return
    const payload = await requestJson<unknown>(`${apiBaseUrl}/pvp/matches/${encodeURIComponent(matchId)}/state`, token)
    const next = normalizeGameState(payload)
    if (next) setGameState(next)
  }, [apiBaseUrl, token])

  const recruit = useCallback(async (matchId: string) => {
    if (!gameState) return null
    setBattleActionMessage('正在请求权威招募…')
    try {
      const result = await mutate<PvpCommandResult>(`/matches/${encodeURIComponent(matchId)}/recruit`, 'POST', {
        requestId: crypto.randomUUID(), expectedTrayRevision: gameState.self.trayRevision,
      })
      setBattleActionMessage(result?.ok ? `招募成功：${String(result.details?.glyph ?? '')}` : `招募失败：${result?.code ?? 'UNKNOWN'}`)
      return result
    } catch (error) {
      await resyncBattle(matchId).catch(() => null)
      setBattleActionMessage(`招募未接受：${error instanceof Error ? error.message : 'UNKNOWN'}`)
      setError(null)
      return null
    }
  }, [gameState, mutate, resyncBattle])

  const deploy = useCallback(async (matchId: string, unitId: string, x: number, y: number) => {
    if (!gameState) return null
    setBattleActionMessage('部署请求已发送…')
    try {
      const result = await mutate<PvpCommandResult>(`/matches/${encodeURIComponent(matchId)}/deploy`, 'POST', {
        requestId: crypto.randomUUID(), unitId, x, y,
        expectedTrayRevision: gameState.self.trayRevision, expectedBoardRevision: gameState.self.boardRevision,
      })
      setBattleActionMessage(result?.ok ? '部署成功。' : `部署失败：${result?.code ?? 'UNKNOWN'}`)
      return result
    } catch (error) {
      await resyncBattle(matchId).catch(() => null)
      setBattleActionMessage(`部署未接受：${error instanceof Error ? error.message : 'UNKNOWN'}`)
      setError(null)
      return null
    }
  }, [gameState, mutate, resyncBattle])

  const moveOrMerge = useCallback(async (matchId: string, entityId: string, x: number, y: number) => {
    if (!gameState) return null
    setBattleActionMessage('移动/合成请求已发送…')
    try {
      const result = await mutate<PvpCommandResult>(`/matches/${encodeURIComponent(matchId)}/move-or-merge`, 'POST', {
        requestId: crypto.randomUUID(), entityId, x, y, expectedBoardRevision: gameState.self.boardRevision,
      })
      setBattleActionMessage(result?.code === 'PIECE_MERGED' ? '合成成功。' : result?.ok ? '移动成功。' : `操作失败：${result?.code ?? 'UNKNOWN'}`)
      return result
    } catch (error) {
      await resyncBattle(matchId).catch(() => null)
      setBattleActionMessage(`操作未接受：${error instanceof Error ? error.message : 'UNKNOWN'}`)
      setError(null)
      return null
    }
  }, [gameState, mutate, resyncBattle])

  return {
    apiBaseUrl,
    data,
    match,
    room,
    gameState,
    queueTicket,
    matchProposal,
    acceptedMatch,
    isLoading,
    isMutating,
    error,
    notice,
    pressureMessage,
    battleActionMessage,
    realtimeStatus,
    loadAckStatus,
    retryLoad: () => setLoadAckStatus('idle'),
    refresh,
    joinQueue,
    cancelQueue,
    acceptMatch,
    createRoom,
    joinRoom,
    setReady,
    surrender,
    sendPressure,
    recruit,
    deploy,
    moveOrMerge,
  }
}
