'use client'

import type { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js'
import type { EnqueueRunPayload, EnqueueRunResult, GridPoint } from '@/lib/domain'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

export type EdgeInvokeError = FunctionsHttpError | FunctionsRelayError | FunctionsFetchError | Error

export interface SubmitRunActionPayload {
  runId: string
  action: {
    actionType: string
    targetKind: string
    targetId?: string
    targetCell?: GridPoint
    payload?: Record<string, unknown>
  }
}

export interface SubmitRunActionResult {
  ok: true
  runId: string
  status: string
  accepted: boolean
  validationCode?: string
  reason?: string
}

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

export async function submitRunAction(payload: SubmitRunActionPayload) {
  const client = getSupabaseBrowserClient()

  if (!client) {
    return {
      data: null,
      error: new Error('Supabase 环境变量未配置，当前仍处于 mock 模式。') satisfies EdgeInvokeError,
    }
  }

  const { data, error } = await client.functions.invoke('submit-run-action', {
    body: payload,
  })

  return {
    data: (data ?? null) as SubmitRunActionResult | null,
    error,
  }
}