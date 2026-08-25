import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveSupabaseAnonKey, resolveSupabaseUrl } from './runtime-config'

let browserClient: SupabaseClient | null | undefined

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) {
    return browserClient
  }

  const url = resolveSupabaseUrl()
  const anonKey = resolveSupabaseAnonKey()

  if (!url || !anonKey) {
    browserClient = null
    return browserClient
  }

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

  return browserClient
}

// Realtime and Auth share one client so refreshed JWTs also reach realtime channels.
export const getSupabaseRealtimeClient = getSupabaseBrowserClient
