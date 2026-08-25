import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config/server-config'

export interface PersistenceReadinessSnapshot {
  status: 'checking' | 'ready' | 'not_ready'
  writable: boolean
  mode: 'memory' | 'supabase'
  checkedAt: string | null
  code: string | null
}

export class PersistenceReadinessTracker {
  private snapshotValue: PersistenceReadinessSnapshot

  constructor(mode: 'memory' | 'supabase') {
    this.snapshotValue = { status: 'checking', writable: false, mode, checkedAt: null, code: null }
  }

  mark(result: Omit<PersistenceReadinessSnapshot, 'mode'>): void {
    this.snapshotValue = { ...result, mode: this.snapshotValue.mode }
  }

  snapshot(): PersistenceReadinessSnapshot { return { ...this.snapshotValue } }
}

export function isPersistenceReadyForTraffic(
  snapshot: PersistenceReadinessSnapshot,
  requiresWritablePersistence: boolean,
): boolean {
  return snapshot.status === 'ready' && (!requiresWritablePersistence || snapshot.writable)
}

export async function probeSupabaseWrite(config: ServerConfig): Promise<Omit<PersistenceReadinessSnapshot, 'mode'>> {
  const checkedAt = new Date().toISOString()
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_NOT_CONFIGURED' }
  }
  const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const probeId = `boot-${crypto.randomUUID()}`
  try {
    const { error: insertError } = await client.from('service_persistence_probes').insert({
      probe_id: probeId,
      service_name: 'agenstd-houduan',
      checked_at: checkedAt,
    })
    if (insertError) return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_WRITE_FAILED' }
    const { error: deleteError } = await client.from('service_persistence_probes').delete().eq('probe_id', probeId)
    if (deleteError) return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_CLEANUP_FAILED' }
    return { status: 'ready', writable: true, checkedAt, code: null }
  }
  catch {
    return { status: 'not_ready', writable: false, checkedAt, code: 'SUPABASE_UNREACHABLE' }
  }
}
