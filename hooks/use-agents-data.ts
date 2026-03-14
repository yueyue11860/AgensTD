'use client'

import { useEffect, useState } from 'react'
import type { Agent } from '@/lib/domain'
import { mockAgents } from '@/lib/mock-data'
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from '@/lib/supabase/browser'
import { fetchAgentOverview } from '@/lib/supabase/repositories'
import { disposeChannel, subscribeToTables } from '@/lib/supabase/realtime'

interface AgentsDataState {
  agents: Agent[]
  isLoading: boolean
  error: string | null
  isUsingFallback: boolean
}

const initialState: AgentsDataState = {
  agents: mockAgents,
  isLoading: hasSupabasePublicEnv(),
  error: null,
  isUsingFallback: true,
}

export function useAgentsData() {
  const [state, setState] = useState<AgentsDataState>(initialState)

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

      const result = await fetchAgentOverview(client)

      if (!isMounted) {
        return
      }

      if (result.error) {
        setState({
          agents: mockAgents,
          isLoading: false,
          error: result.error,
          isUsingFallback: true,
        })
        return
      }

      setState({
        agents: result.data.length > 0 ? result.data : mockAgents,
        isLoading: false,
        error: null,
        isUsingFallback: result.data.length === 0,
      })
    }

    void load()

    const channel = subscribeToTables(
      client,
      'agents-overview',
      [
        { table: 'agents' },
        { table: 'competition_runs' },
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

  return state
}