import { startTransition, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { resolveApiBaseUrl, resolveGatewayToken } from '../lib/runtime-config'
import type { DualLeaderboard, MatchReplay, ReplaySummary } from '../types/competition'

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
  const [leaderboards, setLeaderboards] = useState<DualLeaderboard>(EMPTY_LEADERBOARDS)
  const [replays, setReplays] = useState<ReplaySummary[]>([])
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null)
  const [selectedReplay, setSelectedReplay] = useState<MatchReplay | null>(null)
  const [isLoadingOverview, setIsLoadingOverview] = useState(true)
  const [isLoadingReplayDetail, setIsLoadingReplayDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshOverview = useEffectEvent(async (signal?: AbortSignal) => {
    if (!apiBaseUrl) {
      setError('未解析到 API 地址。')
      setIsLoadingOverview(false)
      return
    }

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
      setIsLoadingOverview(false)
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

  useEffect(() => {
    const controller = new AbortController()
    setIsLoadingOverview(true)
    void refreshOverview(controller.signal)

    const timer = window.setInterval(() => {
      void refreshOverview()
    }, 15000)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refreshOverview])

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
  }, [refreshReplayDetail, selectedReplayId])

  return {
    apiBaseUrl,
    leaderboards,
    replays,
    selectedReplayId,
    selectedReplay,
    isLoadingOverview,
    isLoadingReplayDetail,
    error,
    selectReplay: setSelectedReplayId,
    refresh: () => {
      setIsLoadingOverview(true)
      void refreshOverview()
    },
  }
}