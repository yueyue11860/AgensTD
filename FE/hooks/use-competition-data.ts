import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { getSupabaseRealtimeClient } from '../lib/supabase-browser'
import { resolveApiBaseUrl, resolveGatewayToken } from '../lib/runtime-config'
import type { CompetitionRealtimeStatus, DualLeaderboard, MatchReplay, ReplaySummary } from '../types/competition'

interface LeaderboardResponse {
  ok: boolean
  leaderboards: DualLeaderboard
}

interface ReplayListResponse {
  ok: boolean
  replays: ReplaySummary[]
}

interface ReplayDetailResponse {
  ok: boolean
  replay: MatchReplay
}

const EMPTY_LEADERBOARDS: DualLeaderboard = {
  human: [],
  agent: [],
  all: [],
}

const POLL_INTERVAL_MS = 15000
const REALTIME_FALLBACK_POLL_INTERVAL_MS = 60000
const REALTIME_REFRESH_DEBOUNCE_MS = 400

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function createAuthHeaders(token: string | null) {
  return token
    ? { Authorization: `Bearer ${token}` }
    : undefined
}

async function requestJson<T>(url: string, token: string | null, signal?: AbortSignal) {
  const response = await fetch(url, {
    method: 'GET',
    headers: createAuthHeaders(token),
    signal,
  })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export function useCompetitionData() {
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), [])
  const gatewayToken = useMemo(() => resolveGatewayToken(), [])
  const realtimeClient = useMemo(() => getSupabaseRealtimeClient(), [])
  const [leaderboards, setLeaderboards] = useState<DualLeaderboard>(EMPTY_LEADERBOARDS)
  const [replays, setReplays] = useState<ReplaySummary[]>([])
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null)
  const [selectedReplay, setSelectedReplay] = useState<MatchReplay | null>(null)
  const [isLoadingOverview, setIsLoadingOverview] = useState(true)
  const [isLoadingReplayDetail, setIsLoadingReplayDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<CompetitionRealtimeStatus>(realtimeClient ? 'connecting' : 'disabled')
  const [realtimeError, setRealtimeError] = useState<string | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const isRefreshingOverviewRef = useRef(false)
  const needsOverviewRefreshRef = useRef(false)

  const refreshOverview = useEffectEvent(async (signal?: AbortSignal) => {
    if (!apiBaseUrl) {
      setError('未解析到 API 地址。')
      setIsLoadingOverview(false)
      return
    }

    if (isRefreshingOverviewRef.current) {
      needsOverviewRefreshRef.current = true
      return
    }

    isRefreshingOverviewRef.current = true
    setIsLoadingOverview(true)

    try {
      const [leaderboardPayload, replayPayload] = await Promise.all([
        requestJson<LeaderboardResponse>(`${apiBaseUrl}/leaderboard?limit=8`, gatewayToken, signal),
        requestJson<ReplayListResponse>(`${apiBaseUrl}/replays?limit=8`, gatewayToken, signal),
      ])

      startTransition(() => {
        const nextReplays = replayPayload.replays ?? []
        setLeaderboards(leaderboardPayload.leaderboards ?? EMPTY_LEADERBOARDS)
        setReplays(nextReplays)
        setSelectedReplayId((current) => {
          if (current && nextReplays.some((replay) => replay.matchId === current)) {
            return current
          }

          return nextReplays[0]?.matchId ?? null
        })
      })

      setError(null)
    }
    catch (requestError) {
      if (signal?.aborted) {
        return
      }

      setError(requestError instanceof Error ? requestError.message : '读取排行榜/回放失败。')
    }
    finally {
      isRefreshingOverviewRef.current = false
      setIsLoadingOverview(false)

      if (needsOverviewRefreshRef.current && isPageVisible()) {
        needsOverviewRefreshRef.current = false
        void refreshOverview()
      }
    }
  })

  const refreshReplayDetail = useEffectEvent(async (matchId: string, signal?: AbortSignal) => {
    if (!apiBaseUrl) {
      return
    }

    setIsLoadingReplayDetail(true)

    try {
      const detail = await requestJson<ReplayDetailResponse>(`${apiBaseUrl}/replays/${matchId}`, gatewayToken, signal)
      startTransition(() => {
        setSelectedReplay(detail.replay ?? null)
      })
      setError(null)
    }
    catch (requestError) {
      if (signal?.aborted) {
        return
      }

      setSelectedReplay(null)
      setError(requestError instanceof Error ? requestError.message : '读取回放详情失败。')
    }
    finally {
      setIsLoadingReplayDetail(false)
    }
  })

  const scheduleOverviewRefresh = useEffectEvent(() => {
    if (!isPageVisible()) {
      needsOverviewRefreshRef.current = true
      return
    }

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void refreshOverview()
    }, REALTIME_REFRESH_DEBOUNCE_MS)
  })

  useEffect(() => {
    const controller = new AbortController()
    void refreshOverview(controller.signal)

    const timer = window.setInterval(() => {
      if (!isPageVisible()) {
        return
      }

      void refreshOverview()
    }, realtimeClient ? REALTIME_FALLBACK_POLL_INTERVAL_MS : POLL_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [realtimeClient])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const handleVisibilityChange = () => {
      if (!isPageVisible() || !needsOverviewRefreshRef.current) {
        return
      }

      needsOverviewRefreshRef.current = false
      void refreshOverview()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!realtimeClient) {
      setRealtimeStatus('disabled')
      setRealtimeError(null)
      return
    }

    setRealtimeStatus('connecting')
    setRealtimeError(null)

    const channel = realtimeClient
      .channel(`competition-overview-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'leaderboard_entries',
      }, () => {
        scheduleOverviewRefresh()
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'match_replays',
      }, () => {
        scheduleOverviewRefresh()
      })

    channel.subscribe((status, subscribeError) => {
      if (status === 'SUBSCRIBED') {
        setRealtimeStatus('subscribed')
        setRealtimeError(null)
        return
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setRealtimeStatus('error')
        setRealtimeError(subscribeError?.message ?? 'Supabase Realtime 连接失败。')
        return
      }

      if (status === 'CLOSED') {
        setRealtimeStatus('connecting')
      }
    })

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }

      void realtimeClient.removeChannel(channel)
    }
  }, [realtimeClient])

  useEffect(() => {
    if (!selectedReplayId) {
      setSelectedReplay(null)
      return
    }

    const controller = new AbortController()
    void refreshReplayDetail(selectedReplayId, controller.signal)
    return () => {
      controller.abort()
    }
  }, [selectedReplayId])

  return {
    apiBaseUrl,
    leaderboards,
    replays,
    selectedReplayId,
    selectedReplay,
    isLoadingOverview,
    isLoadingReplayDetail,
    error,
    realtimeStatus,
    realtimeError,
    selectReplay: setSelectedReplayId,
    refresh: () => {
      void refreshOverview()
    },
  }
}