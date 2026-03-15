'use client'

import { useEffect, useState } from 'react'
import {
  mockCoreScenario,
  mockCoreSnapshots,
  type CoreRunScenario,
} from '@/lib/mock-data'
import type { CoreReplaySnapshot, RunActionLogEntry } from '@/lib/domain'
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from '@/lib/supabase/browser'
import { fetchLiveRunScenario } from '@/lib/supabase/live-run'
import { disposeChannel, subscribeToTables } from '@/lib/supabase/realtime'

interface LiveRunState {
  runId: string | null
  scenario: CoreRunScenario
  snapshots: CoreReplaySnapshot[]
  recentActions: RunActionLogEntry[]
  isLoading: boolean
  error: string | null
  isUsingFallback: boolean
}

interface UseLiveRunOptions {
  difficulty?: CoreRunScenario['difficulty']
  runId?: string
  enabled?: boolean
  fallbackScenario?: CoreRunScenario
  fallbackSnapshots?: CoreReplaySnapshot[]
}

export function useLiveRun({
  difficulty,
  runId,
  enabled = true,
  fallbackScenario = mockCoreScenario,
  fallbackSnapshots = mockCoreSnapshots,
}: UseLiveRunOptions = {}) {
  const [state, setState] = useState<LiveRunState>({
    runId: null,
    scenario: fallbackScenario,
    snapshots: fallbackSnapshots,
    recentActions: [],
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
          recentActions: [],
          isLoading: true,
          isUsingFallback: true,
        }))
      }

      const result = await fetchLiveRunScenario(client, { difficulty, runId })

      if (!isMounted) {
        return
      }

      setState({
        runId: result.data.runId,
        scenario: result.data.runId ? result.data.scenario : fallbackScenario,
        snapshots: result.data.runId ? result.data.snapshots : fallbackSnapshots,
        recentActions: result.data.runId ? result.data.recentActions : [],
        isLoading: false,
        error: result.error,
        isUsingFallback: !result.data.runId,
      })
    }

    void load()

    const channel = subscribeToTables(
      client,
      `live-run-${runId ?? difficulty ?? 'all'}`,
      runId
        ? [
            { table: 'competition_runs', filter: `id=eq.${runId}` },
            { table: 'run_snapshots', filter: `run_id=eq.${runId}` },
            { table: 'run_actions', filter: `run_id=eq.${runId}` },
          ]
        : [
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
  }, [difficulty, enabled, fallbackScenario, fallbackSnapshots, runId])

  return {
    ...state,
    scenario: state.runId ? state.scenario : fallbackScenario,
    snapshots: state.runId ? state.snapshots : fallbackSnapshots,
    recentActions: state.runId ? state.recentActions : [],
    isUsingFallback: state.runId ? state.isUsingFallback : true,
  }
}