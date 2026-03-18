interface RuntimeWindow extends Window {
  __ENV__?: Record<string, string | undefined>
}

function getRuntimeWindow() {
  if (typeof window === 'undefined') {
    return null
  }

  return window as RuntimeWindow
}

function readConfiguredValue(...keys: string[]) {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return null
  }

  for (const key of keys) {
    const runtimeValue = runtimeWindow.__ENV__?.[key]
    if (runtimeValue) {
      return runtimeValue
    }

    const envValue = import.meta.env[key as keyof ImportMetaEnv]
    if (typeof envValue === 'string' && envValue.length > 0) {
      return envValue
    }
  }

  return null
}

export function resolveSocketUrl() {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return null
  }

  const configuredUrl = readConfiguredValue('VITE_WS_URL', 'WS_URL')
  if (configuredUrl) {
    return configuredUrl
  }

  if (import.meta.env.DEV) {
    const protocol = runtimeWindow.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${runtimeWindow.location.hostname}:3000`
  }

  return runtimeWindow.location.origin
}

export function resolveGatewayToken() {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return null
  }

  // 优先使用 OAuth session token
  try {
    const sessionToken = localStorage.getItem('agenstd_session_token')
    if (sessionToken) return sessionToken
  } catch { /* ignore */ }

  const configuredToken = readConfiguredValue('VITE_GATEWAY_TOKEN', 'WS_TOKEN')
  if (configuredToken) {
    return configuredToken
  }

  if (import.meta.env.DEV) {
    return 'human-dev-token'
  }

  return null
}

export function resolveApiBaseUrl() {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return null
  }

  const configuredUrl = readConfiguredValue('VITE_API_BASE_URL', 'API_BASE_URL')
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '')
  }

  if (import.meta.env.DEV) {
    const protocol = runtimeWindow.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${runtimeWindow.location.hostname}:3000/api`
  }

  return `${runtimeWindow.location.origin}/api`
}

export function resolveSupabaseUrl() {
  return readConfiguredValue('VITE_SUPABASE_URL', 'SUPABASE_URL')
}

export function resolveSupabaseAnonKey() {
  return readConfiguredValue('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY')
}

/**
 * 解析当前玩家 ID。
 * 优先读取环境变量 VITE_PLAYER_ID；
 * 开发模式下回退到 'human-dev'（与 BE 默认 authTokens 对齐）。
 */
export function resolvePlayerId(): string | null {
  // 优先使用 OAuth 用户 ID
  try {
    const userJson = localStorage.getItem('agenstd_auth_user')
    if (userJson) {
      const user = JSON.parse(userJson) as { userId?: string }
      if (user.userId) return user.userId
    }
  } catch { /* ignore */ }

  const configured = readConfiguredValue('VITE_PLAYER_ID', 'PLAYER_ID')
  if (configured) {
    return configured
  }

  if (import.meta.env.DEV) {
    return 'human-dev'
  }

  return null
}

/**
 * 解析当前玩家类型（'human' | 'agent'）。
 * 优先读取 VITE_PLAYER_KIND；开发环境默认 'human'。
 */
export function resolvePlayerKind(): 'human' | 'agent' {
  const configured = readConfiguredValue('VITE_PLAYER_KIND', 'PLAYER_KIND')
  if (configured === 'agent') {
    return 'agent'
  }

  return 'human'
}