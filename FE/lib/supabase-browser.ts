import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getRuntimeAccessToken, getRuntimeAuthIdentity } from './auth-session-bridge'
import { getLocalTestAccount, isLocalTestSession } from './local-test-auth'
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
// 本地测试账号仅使用内存后端，不应触发任何 Supabase 连接。
export function getSupabaseRealtimeClient() {
  const localTestAccount = getLocalTestAccount()
  if (localTestAccount && isLocalTestSession(localTestAccount, getRuntimeAccessToken(), getRuntimeAuthIdentity())) {
    return null
  }
  return getSupabaseBrowserClient()
}
