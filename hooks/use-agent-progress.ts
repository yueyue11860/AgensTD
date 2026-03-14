'use client'

import { useEffect, useState } from 'react'
import type { DifficultyProgress } from '@/lib/domain'
import { mockDifficultyProgress } from '@/lib/mock-data'
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from '@/lib/supabase/browser'
import { fetchAgentDifficultyProgress } from '@/lib/supabase/repositories'
import { disposeChannel, subscribeToTables } from '@/lib/supabase/realtime'

interface AgentProgressState {
  progress: DifficultyProgress[]
  isLoading: boolean
  error: string | null
  isUsingFallback: boolean
}

export function useAgentProgress(agentId?: string) {
  const [state, setState] = useState<AgentProgressState>({
    progress: mockDifficultyProgress,
    isLoading: Boolean(agentId) && hasSupabasePublicEnv(),
    error: null,
    isUsingFallback: true,
  })

  useEffect(() => {
    if (!agentId) {
      return
    }

    let isMounted = true
    const client = getSupabaseBrowserClient()

    if (!client) {
      return
    }

    const load = async (background = false) => {
      if (!background && isMounted) {
        setState((current) => ({ ...current, isLoading: true }))
      }

      const result = await fetchAgentDifficultyProgress(client, agentId)

      if (!isMounted) {
        return
      }

      if (result.error) {
        setState({
          progress: mockDifficultyProgress,
          isLoading: false,
          error: result.error,
          isUsingFallback: true,
        })
        return
      }

      setState({
        progress: result.data.length > 0 ? result.data : mockDifficultyProgress,
        isLoading: false,
        error: null,
        isUsingFallback: result.data.length === 0,
      })
    }

    void load()

    const channel = subscribeToTables(
      client,
      `agent-progress-${agentId}`,
      [{ table: 'competition_runs', filter: `agent_id=eq.${agentId}` }],
      () => {
        void load(true)
      },
    )

    return () => {
      isMounted = false
      void disposeChannel(client, channel)
    }
  }, [agentId])

  return state
}