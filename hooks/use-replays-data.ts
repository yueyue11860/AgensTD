'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Run } from '@/lib/domain'
import { mockRuns } from '@/lib/mock-data'
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from '@/lib/supabase/browser'
import { fetchReplayLibrary } from '@/lib/supabase/repositories'
import { disposeChannel, subscribeToTables } from '@/lib/supabase/realtime'

interface ReplaysDataState {
  runs: Run[]
  isLoading: boolean
  error: string | null
  isUsingFallback: boolean
}

const fallbackRuns = mockRuns.filter((run) => run.status === 'completed' || run.status === 'failed')

export function useReplaysData(searchQuery: string) {
  const [state, setState] = useState<ReplaysDataState>({
    runs: fallbackRuns,
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

      const result = await fetchReplayLibrary(client)

      if (!isMounted) {
        return
      }

      if (result.error) {
        setState({
          runs: fallbackRuns,
          isLoading: false,
          error: result.error,
          isUsingFallback: true,
        })
        return
      }

      setState({
        runs: result.data.length > 0 ? result.data : fallbackRuns,
        isLoading: false,
        error: null,
        isUsingFallback: result.data.length === 0,
      })
    }

    void load()

    const channel = subscribeToTables(
      client,
      'replay-library',
      [
        { table: 'competition_runs' },
        { table: 'run_snapshots' },
      ],
      () => {
        void load(true)
      },
    )

    return () => {
      isMounted = false
      void disposeChannel(client, channel)
    }
  }, [])

  const filteredRuns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    if (!query) {
      return state.runs
    }

    return state.runs.filter((run) => {
      return (
        run.agent_name.toLowerCase().includes(query) ||
        run.run_id.toLowerCase().includes(query) ||
        String(run.seed).includes(query)
      )
    })
  }, [searchQuery, state.runs])

  return {
    ...state,
    runs: filteredRuns,
  }
}