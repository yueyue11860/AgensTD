import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveSupabaseAnonKey, resolveSupabaseUrl } from './runtime-config'

let browserClient: SupabaseClient | null | undefined

export function getSupabaseRealtimeClient() {
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
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return browserClient
}