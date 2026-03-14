'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SeasonRanking } from '@/lib/domain'
import { mockRankings } from '@/lib/mock-data'
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from '@/lib/supabase/browser'
import { fetchSeasonRankings } from '@/lib/supabase/repositories'
import { disposeChannel, subscribeToTables } from '@/lib/supabase/realtime'

interface RankingsDataState {
  rankings: SeasonRanking[]
  isLoading: boolean
  error: string | null
  isUsingFallback: boolean
}

export function useRankingsData(seasonCode: string, difficulty: string) {
  const [state, setState] = useState<RankingsDataState>({
    rankings: mockRankings,
    isLoading: hasSupabasePublicEnv(),
    error: null,
    isUsingFallback: true,
  })

  useEffect(() => {
    let isMounted = true
    const client = getSupabaseBrowserClient()

    if (!client) {
      return
    }

    const load = async (background = false) => {
      if (!background && isMounted) {
        setState((current) => ({ ...current, isLoading: true }))
      }

      const result = await fetchSeasonRankings(client, seasonCode)

      if (!isMounted) {
        return
      }

      if (result.error) {
        setState({
          rankings: mockRankings,
          isLoading: false,
          error: result.error,
          isUsingFallback: true,
        })
        return
      }

      setState({
        rankings: result.data.length > 0 ? result.data : mockRankings,
        isLoading: false,
        error: null,
        isUsingFallback: result.data.length === 0,
      })
    }

    void load()

    const channel = subscribeToTables(
      client,
      `season-rankings-${seasonCode}`,
      [{ table: 'competition_runs' }],
      () => {
        void load(true)
      },
    )

    return () => {
      isMounted = false
      void disposeChannel(client, channel)
    }
  }, [seasonCode])

  const filteredRankings = useMemo(() => {
    if (difficulty === 'ALL') {
      return state.rankings
    }

    return state.rankings.filter((entry) => entry.difficulty_cleared.includes(difficulty))
  }, [difficulty, state.rankings])

  return {
    ...state,
    rankings: filteredRankings,
  }
}