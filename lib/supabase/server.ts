import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { getSupabasePublicEnv } from '@/lib/supabase/env'

export async function getSupabaseServerClient() {
  const env = getSupabasePublicEnv()

  if (!env) {
    return null
  }

  const cookieStore = await cookies()

  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components may read cookies without a writable response.
        }
      },
    },
  })
}