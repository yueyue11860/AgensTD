export interface SupabasePublicEnv {
  url: string
  anonKey: string
}

export interface SupabaseServiceEnv extends SupabasePublicEnv {
  serviceRoleKey: string
}

export interface SupabaseRunnerInvokeEnv extends SupabasePublicEnv {
  runnerSecret: string
}

function readPublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return null
  }

  return { url, anonKey }
}

export function getSupabasePublicEnv() {
  return readPublicEnv()
}

export function hasSupabasePublicEnv() {
  return Boolean(readPublicEnv())
}

export function getSupabaseServiceEnv(): SupabaseServiceEnv | null {
  const publicEnv = readPublicEnv()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!publicEnv || !serviceRoleKey) {
    return null
  }

  return {
    ...publicEnv,
    serviceRoleKey,
  }
}

export function getSupabaseRunnerInvokeEnv(): SupabaseRunnerInvokeEnv | null {
  const publicEnv = readPublicEnv()
  const runnerSecret = process.env.RUNNER_SECRET ?? process.env.SUPABASE_RUNNER_SECRET

  if (!publicEnv || !runnerSecret) {
    return null
  }

  return {
    ...publicEnv,
    runnerSecret,
  }
}