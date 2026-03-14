import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'
import { getSupabaseServiceEnv } from './env.ts'

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