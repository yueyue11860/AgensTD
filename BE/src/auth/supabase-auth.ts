import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { ServerConfig } from '../config/server-config'

export interface SupabaseIdentity {
  userId: string
  name: string
  email: string
  avatar: string
}

type AuthClient = Pick<SupabaseClient, 'auth'>

function mapUser(user: User): SupabaseIdentity {
  const metadata = user.user_metadata ?? {}
  const email = user.email ?? ''
  return {
    userId: user.id,
    name: String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? email.split('@')[0] ?? user.id),
    email,
    avatar: String(metadata.avatar_url ?? metadata.picture ?? ''),
  }
}

export class SupabaseAuthVerifier {
  private readonly client: AuthClient | null

  constructor(config: Pick<ServerConfig, 'supabaseUrl' | 'supabaseServiceRoleKey'>, client?: AuthClient) {
    this.client = client ?? (config.supabaseUrl && config.supabaseServiceRoleKey
      ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null)
  }

  isEnabled() {
    return this.client !== null
  }

  async verify(accessToken: string): Promise<SupabaseIdentity | null> {
    if (!this.client || accessToken.split('.').length !== 3) return null
    const { data, error } = await this.client.auth.getUser(accessToken)
    if (error || !data.user) return null
    return mapUser(data.user)
  }
}

let defaultVerifier: SupabaseAuthVerifier | null = null

export function configureSupabaseAuthVerifier(verifier: SupabaseAuthVerifier) {
  defaultVerifier = verifier
}

export function getSupabaseAuthVerifier() {
  return defaultVerifier
}
