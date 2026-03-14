'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { getSupabasePublicEnv, hasSupabasePublicEnv } from '@/lib/supabase/env'

let browserClient: SupabaseClient<Database> | null = null

export function getSupabaseBrowserClient() {
  const env = getSupabasePublicEnv()

  if (!env) {
    return null
  }

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(env.url, env.anonKey)
  }

  return browserClient
}

export { hasSupabasePublicEnv }