import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { getSupabaseServiceEnv } from '@/lib/supabase/env'

export function getSupabaseAdminClient() {
  const env = getSupabaseServiceEnv()

  if (!env) {
    return null
  }

  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}