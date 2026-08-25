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
import type { PvpCommandResult } from '../../shared/contracts/pvp'

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
  const value = asRecord(unwrap<unknown>(payload, ['state', 'gameState']))
  if (!value || !readString(value, 'matchId')) return null
  if (isRecord(value.self) && isRecord(value.opponent)) return value as unknown as PvpMatchPublicState
  const sides = asRecord(value.sides)
  const sideA = asRecord(sides?.A); const sideB = asRecord(sides?.B)
  const viewerPlayerId = readString(value, 'viewerPlayerId') || resolvePlayerId()
  const selfSide = readString(sideA, 'playerId') === viewerPlayerId || sideA?.privateState ? sideA : sideB
  const opponentSide = selfSide === sideA ? sideB : sideA
  const round = asRecord(value.round); const tribulation = asRecord(value.tribulation)
  const recentEvents = Array.isArray(value.recentEvents) ? value.recentEvents.map(asRecord).filter((event): event is Record<string, unknown> => event !== null) : []
  return {
    matchId: readString(value, 'matchId'), status: (readString(value, 'phase', 'status') || 'waiting_players') as PvpMatchPublicState['status'],
    mapId: readString(value, 'mapId'), mapVersion: String(value.mapVersion ?? ''), rulesetVersion: readString(value, 'rulesetVersion'),
    elapsedMs: readNumber(value, 'elapsedMs') || readNumber(value, 'tick') * readNumber(value, 'tickRateMs'), round: readNumber(round, 'number'), disasterLevel: readNumber(tribulation, 'tier'),
    self: { playerId: readString(selfSide, 'playerId'), playerName: readString(selfSide, 'playerName') || '我方', coreHp: readNumber(selfSide, 'coreHp'), rations: readNumber(selfSide, 'rations'), scripture: readNumber(selfSide, 'scripture') },
    opponent: { playerId: readString(opponentSide, 'playerId'), playerName: readString(opponentSide, 'playerName') || '对手', coreHp: readNumber(opponentSide, 'coreHp') },
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
    let timer: number | null = null
    let receivedState = false
    const poll = async () => {
      try {
        const payload = await requestJson<unknown>(`${apiBaseUrl}/pvp/matches/${encodeURIComponent(options.matchId!)}/state`, token)
        if (!active) return
        const next = normalizeGameState(payload)
        if (next) {
          receivedState = true
          setGameState(next)
          if (next.status === 'completed' || next.status === 'voided') return
        }
      } catch (requestError) {
        if (active && !receivedState) setError(requestError instanceof Error ? requestError.message : 'PVP 权威状态读取失败。')
      }
      if (active) timer = window.setTimeout(() => void poll(), 500)
    }
    void poll()
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [apiBaseUrl, options.matchId, token])

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
        body: body ? JSON.stringify({ ...body, requestId: crypto.randomUUID() }) : undefined,
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
    refresh,
    joinQueue,
    cancelQueue,
    acceptMatch,
    createRoom,
    joinRoom,
    setReady,
    surrender,
    sendPressure,
  }
}
