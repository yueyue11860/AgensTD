import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config/server-config'
import type { PlayerAccountRecord } from '../account-v1/types'
import type { PlayerAccountStore } from './player-account-store'

/**
 * player_accounts 只用 player_id(text) 作业务主键，不依赖 users 外键，
 * 所以本地开发身份和静态 Agent 身份也能持久化。
 */
export class SupabasePlayerAccountStore implements PlayerAccountStore {
  private readonly client: SupabaseClient | null

  constructor(config: ServerConfig) {
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    } else {
      this.client = null
    }
  }

  isEnabled(): boolean {
    return this.client !== null
  }

  async get(playerId: string): Promise<PlayerAccountRecord | null> {
    const client = this.requireClient()
    const { data, error } = await client
      .from('player_accounts')
      .select('account_json')
      .eq('player_id', playerId)
      .maybeSingle()
    if (error) throw new Error(`player account read failed: ${error.message}`)
    return data ? structuredClone(data.account_json as PlayerAccountRecord) : null
  }

  async createIfAbsent(account: PlayerAccountRecord): Promise<PlayerAccountRecord> {
    const client = this.requireClient()
    const { error } = await client
      .from('player_accounts')
      .upsert({
        player_id: account.playerId,
        version: account.version,
        account_json: account,
        updated_at: account.updatedAt,
      }, {
        onConflict: 'player_id',
        ignoreDuplicates: true,
      })
    if (error) throw new Error(`player account create failed: ${error.message}`)
    const stored = await this.get(account.playerId)
    if (!stored) throw new Error('player account disappeared after create')
    return stored
  }

  async compareAndSwap(
    playerId: string,
    expectedVersion: number,
    next: PlayerAccountRecord,
  ): Promise<boolean> {
    if (next.playerId !== playerId || next.version !== expectedVersion + 1) return false
    const client = this.requireClient()
    const { data, error } = await client.rpc('cas_player_account', {
      p_player_id: playerId,
      p_expected_version: expectedVersion,
      p_next_account: next,
    })
    if (error) throw new Error(`player account CAS failed: ${error.message}`)
    return data === true
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase player account store is disabled')
    return this.client
  }
}

