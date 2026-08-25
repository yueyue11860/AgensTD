import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config/server-config'
import { PveCheckpointStoreError, type PveCheckpointStore } from '../pve-checkpoint-v1/store'
import type {
  DurablePveActionCommand,
  DurablePveActionRecord,
  PveMatchCheckpoint,
  PveMatchLease,
  ReserveActionResult,
} from '../pve-checkpoint-v1/types'

type Row = Record<string, unknown>
const clone = <T>(value: T): T => structuredClone(value)

function requiredString(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`Invalid PVE checkpoint field ${key}`)
  return value
}

function requiredNumber(row: Row, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid PVE checkpoint field ${key}`)
  return value
}

function leaseFromRow(row: Row): PveMatchLease {
  return {
    matchId: requiredString(row, 'match_id'), roomId: requiredString(row, 'room_id'),
    holderId: requiredString(row, 'holder_id'), generation: requiredNumber(row, 'generation'),
    leaseExpiresAt: requiredString(row, 'lease_expires_at'),
  }
}

function checkpointFromRow(row: Row): PveMatchCheckpoint {
  return {
    schemaVersion: 1,
    matchId: requiredString(row, 'match_id'), roomId: requiredString(row, 'room_id'),
    generation: requiredNumber(row, 'generation'), checkpointTick: requiredNumber(row, 'checkpoint_tick'),
    lastActionSequence: requiredNumber(row, 'last_action_sequence'),
    combatRulesetVersion: requiredString(row, 'combat_ruleset_version'),
    configSnapshot: clone(row.config_snapshot as PveMatchCheckpoint['configSnapshot']),
    stateHash: requiredString(row, 'state_hash'), payload: clone(row.payload_json as Record<string, unknown>),
    createdAt: requiredString(row, 'created_at'),
  }
}

function actionFromRow(row: Row): DurablePveActionRecord {
  return {
    matchId: requiredString(row, 'match_id'), roomId: requiredString(row, 'room_id'),
    generation: requiredNumber(row, 'generation'), actionSequence: requiredNumber(row, 'action_sequence'),
    playerId: requiredString(row, 'player_id'), requestId: requiredString(row, 'request_id'),
    actionId: requiredString(row, 'action_id'), fingerprint: requiredString(row, 'fingerprint'),
    payload: clone(row.payload_json as Record<string, unknown>), serverTick: requiredNumber(row, 'server_tick'),
    rateLimitRemaining: requiredNumber(row, 'rate_limit_remaining'), createdAt: requiredString(row, 'created_at'),
  }
}

function storeError(error: { message?: string }, fallback: string): Error {
  if (error.message?.includes('PVE_LEASE_FENCED')) return new PveCheckpointStoreError('LEASE_FENCED', 'PVE lease was fenced')
  if (error.message?.includes('PVE_LEASE_HELD')) return new PveCheckpointStoreError('LEASE_FENCED', 'PVE lease is still held by another process')
  if (error.message?.includes('PVE_CHECKPOINT_CONFLICT')) return new PveCheckpointStoreError('CHECKPOINT_CONFLICT', 'PVE checkpoint moved backwards')
  return new Error(`${fallback}: ${error.message ?? 'UNKNOWN'}`)
}

/** Service-role-only adapter. Lease/action/checkpoint mutations use fenced Postgres RPCs. */
export class SupabasePveCheckpointStore implements PveCheckpointStore {
  private readonly client: SupabaseClient | null

  constructor(config: ServerConfig) {
    this.client = config.supabaseUrl && config.supabaseServiceRoleKey
      ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null
  }

  isEnabled(): boolean { return this.client !== null }

  async claimLease(input: { matchId: string; roomId: string; holderId: string; ttlMs: number }): Promise<PveMatchLease> {
    const { data, error } = await this.requireClient().rpc('claim_pve_match_lease', {
      p_match_id: input.matchId, p_room_id: input.roomId, p_holder_id: input.holderId, p_ttl_ms: input.ttlMs,
    }).single()
    if (error) throw storeError(error, 'PVE lease claim failed')
    return leaseFromRow(data as Row)
  }

  async renewLease(lease: PveMatchLease, ttlMs: number): Promise<PveMatchLease> {
    const { data, error } = await this.requireClient().rpc('renew_pve_match_lease', {
      p_match_id: lease.matchId, p_holder_id: lease.holderId, p_generation: lease.generation, p_ttl_ms: ttlMs,
    }).maybeSingle()
    if (error) throw storeError(error, 'PVE lease renewal failed')
    if (!data) throw new PveCheckpointStoreError('LEASE_FENCED', 'PVE lease expired or was superseded')
    return leaseFromRow(data as Row)
  }

  async loadCheckpoint(matchId: string): Promise<PveMatchCheckpoint | null> {
    const { data, error } = await this.requireClient().from('pve_match_checkpoints').select('*')
      .eq('match_id', matchId).maybeSingle()
    if (error) throw new Error(`PVE checkpoint read failed: ${error.message}`)
    return data ? checkpointFromRow(data as Row) : null
  }

  async loadLatestCheckpointForRoom(roomId: string): Promise<PveMatchCheckpoint | null> {
    const { data, error } = await this.requireClient().from('pve_match_checkpoints').select('*')
      .eq('room_id', roomId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw new Error(`PVE room checkpoint read failed: ${error.message}`)
    return data ? checkpointFromRow(data as Row) : null
  }

  async listLatestCheckpoints(limit = 1000): Promise<readonly PveMatchCheckpoint[]> {
    const latestByRoom = new Map<string, PveMatchCheckpoint>()
    const pageSize = 1000
    for (let offset = 0; latestByRoom.size < limit; offset += pageSize) {
      const { data, error } = await this.requireClient().from('pve_match_checkpoints').select('*')
        .order('updated_at', { ascending: false }).range(offset, offset + pageSize - 1)
      if (error) throw new Error(`PVE checkpoint discovery failed: ${error.message}`)
      const rows = data as Row[]
      for (const row of rows) {
        const checkpoint = checkpointFromRow(row)
        if (!latestByRoom.has(checkpoint.roomId)) latestByRoom.set(checkpoint.roomId, checkpoint)
        if (latestByRoom.size >= limit) break
      }
      if (rows.length < pageSize) break
    }
    return [...latestByRoom.values()].slice(0, limit)
  }

  async saveCheckpoint(lease: PveMatchLease, checkpoint: Omit<PveMatchCheckpoint, 'generation'>): Promise<PveMatchCheckpoint> {
    const { error } = await this.requireClient().rpc('save_pve_match_checkpoint', {
      p_match_id: checkpoint.matchId, p_room_id: checkpoint.roomId, p_holder_id: lease.holderId,
      p_generation: lease.generation, p_schema_version: checkpoint.schemaVersion,
      p_checkpoint_tick: checkpoint.checkpointTick, p_last_action_sequence: checkpoint.lastActionSequence,
      p_combat_ruleset_version: checkpoint.combatRulesetVersion, p_config_snapshot: checkpoint.configSnapshot,
      p_state_hash: checkpoint.stateHash, p_payload_json: checkpoint.payload, p_created_at: checkpoint.createdAt,
    })
    if (error) throw storeError(error, 'PVE checkpoint write failed')
    const stored = await this.loadCheckpoint(checkpoint.matchId)
    if (!stored || stored.generation !== lease.generation || stored.stateHash !== checkpoint.stateHash) {
      throw new PveCheckpointStoreError('CHECKPOINT_CONFLICT', 'PVE checkpoint write verification failed')
    }
    return stored
  }

  async getAction(matchId: string, playerId: string, requestId: string): Promise<DurablePveActionRecord | null> {
    const { data, error } = await this.requireClient().from('pve_match_actions').select('*')
      .eq('match_id', matchId).eq('player_id', playerId).eq('request_id', requestId).maybeSingle()
    if (error) throw new Error(`PVE durable action read failed: ${error.message}`)
    return data ? actionFromRow(data as Row) : null
  }

  async reserveAction(lease: PveMatchLease, command: DurablePveActionCommand, leaseTtlMs: number): Promise<ReserveActionResult> {
    const { data, error } = await this.requireClient().rpc('reserve_pve_match_action', {
      p_match_id: command.matchId, p_room_id: command.roomId, p_holder_id: lease.holderId,
      p_generation: lease.generation, p_player_id: command.playerId, p_request_id: command.requestId,
      p_action_id: command.actionId, p_fingerprint: command.fingerprint, p_payload_json: command.payload,
      p_server_tick: command.serverTick, p_rate_limit_remaining: command.rateLimitRemaining, p_ttl_ms: leaseTtlMs,
    }).single()
    if (error) throw storeError(error, 'PVE action reservation failed')
    const disposition = requiredString(data as Row, 'disposition') as ReserveActionResult['status']
    const record = actionFromRow((data as Row).record_json as Row)
    if (!['reserved', 'duplicate', 'conflict'].includes(disposition)) throw new Error('PVE action reservation returned invalid data')
    return { status: disposition, record } as ReserveActionResult
  }

  async listActionsAfter(matchId: string, actionSequence: number, limit = 1000): Promise<readonly DurablePveActionRecord[]> {
    const { data, error } = await this.requireClient().from('pve_match_actions').select('*')
      .eq('match_id', matchId).gt('action_sequence', actionSequence).order('action_sequence').limit(limit)
    if (error) throw new Error(`PVE durable action replay read failed: ${error.message}`)
    return (data as Row[]).map(actionFromRow)
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase PVE checkpoint persistence is disabled')
    return this.client
  }
}
