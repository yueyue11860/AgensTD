'use client'

import type { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js'
import type { EnqueueRunPayload, EnqueueRunResult } from '@/lib/domain'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

export type EdgeInvokeError = FunctionsHttpError | FunctionsRelayError | FunctionsFetchError | Error

export async function enqueueRun(payload: EnqueueRunPayload) {
  const client = getSupabaseBrowserClient()

  if (!client) {
    return {
      data: null,
      error: new Error('Supabase 环境变量未配置，当前仍处于 mock 模式。') satisfies EdgeInvokeError,
    }
  }

  const { data, error } = await client.functions.invoke('enqueue-run', {
    body: payload,
  })

  return {
    data: (data ?? null) as EnqueueRunResult | null,
    error,
  }
}