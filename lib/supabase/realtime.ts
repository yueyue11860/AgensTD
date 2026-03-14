import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export interface RealtimeTarget {
  table: string
  schema?: string
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'
  filter?: string
}

export function subscribeToTables(
  client: SupabaseClient<Database>,
  channelName: string,
  targets: RealtimeTarget[],
  onChange: () => void,
) {
  const channel = client.channel(channelName)

  targets.forEach((target) => {
    channel.on(
      'postgres_changes',
      {
        event: target.event ?? '*',
        schema: target.schema ?? 'public',
        table: target.table,
        filter: target.filter,
      },
      onChange,
    )
  })

  channel.subscribe()

  return channel
}

export async function disposeChannel(
  client: SupabaseClient<Database>,
  channel: RealtimeChannel | null,
) {
  if (!channel) {
    return
  }

  await client.removeChannel(channel)
}