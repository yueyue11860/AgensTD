'use client'

import { useEffect, useState } from 'react'
import {
  mockCoreScenario,
  mockCoreSnapshots,
  type CoreRunScenario,
  type ReplaySnapshot,
} from '@/lib/mock-data'
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from '@/lib/supabase/browser'
import { fetchLiveRunScenario } from '@/lib/supabase/live-run'
import { disposeChannel, subscribeToTables } from '@/lib/supabase/realtime'

interface LiveRunState {
  runId: string | null
  scenario: CoreRunScenario
  snapshots: ReplaySnapshot[]
  isLoading: boolean
  error: string | null
  isUsingFallback: boolean
}

interface UseLiveRunOptions {
  difficulty?: CoreRunScenario['difficulty']
  enabled?: boolean
  fallbackScenario?: CoreRunScenario
  fallbackSnapshots?: ReplaySnapshot[]
}

export function useLiveRun({
  difficulty,
  enabled = true,
  fallbackScenario = mockCoreScenario,
  fallbackSnapshots = mockCoreSnapshots,
}: UseLiveRunOptions = {}) {
  const [state, setState] = useState<LiveRunState>({
    runId: null,
    scenario: fallbackScenario,
    snapshots: fallbackSnapshots,
    isLoading: enabled && hasSupabasePublicEnv(),
    error: null,
    isUsingFallback: true,
  })

  useEffect(() => {
    if (!enabled) {
      return
    }

    let isMounted = true
    const client = getSupabaseBrowserClient()

    if (!client) {
      return
    }

    const load = async (background = false) => {
      if (!background && isMounted) {
        setState((current) => ({
          ...current,
          scenario: fallbackScenario,
          snapshots: fallbackSnapshots,
          isLoading: true,
          isUsingFallback: true,
        }))
      }

      const result = await fetchLiveRunScenario(client, { difficulty })

      if (!isMounted) {
        return
      }

      setState({
        runId: result.data.runId,
        scenario: result.data.runId ? result.data.scenario : fallbackScenario,
        snapshots: result.data.runId ? result.data.snapshots : fallbackSnapshots,
        isLoading: false,
        error: result.error,
        isUsingFallback: !result.data.runId,
      })
    }

    void load()

    const channel = subscribeToTables(
      client,
      `live-run-${difficulty ?? 'all'}`,
      [
        { table: 'competition_runs' },
        { table: 'run_snapshots' },
        { table: 'agents' },
      ],
      () => {
        void load(true)
      },
    )

    return () => {
      isMounted = false
      void disposeChannel(client, channel)
    }
  }, [difficulty, enabled, fallbackScenario, fallbackSnapshots])

  return {
    ...state,
    scenario: state.runId ? state.scenario : fallbackScenario,
    snapshots: state.runId ? state.snapshots : fallbackSnapshots,
    isUsingFallback: state.runId ? state.isUsingFallback : true,
  }
}