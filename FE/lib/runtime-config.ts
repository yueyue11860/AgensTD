interface RuntimeWindow extends Window {
  __ENV__?: Record<string, string | undefined>
}

const STICKY_RUNTIME_KEYS = ['playerId', 'playerName', 'playerKind', 'token', 'gatewayToken', 'apiBaseUrl', 'apiUrl', 'wsUrl', 'socketUrl'] as const
const STICKY_RUNTIME_STORAGE_PREFIX = 'agenstd_runtime_override:'

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function getRuntimeWindow() {
  if (typeof window === 'undefined') {
    return null
  }

  return window as RuntimeWindow
}

function readUrlQueryValue(...keys: string[]) {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return null
  }

  const searchParams = new URLSearchParams(runtimeWindow.location.search)
  for (const key of keys) {
    const value = searchParams.get(key)?.trim()
    if (value) {
      return value
    }
  }

  return null
}

function readStickyRuntimeValue(...keys: string[]) {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return null
  }

  for (const key of keys) {
    try {
      const value = runtimeWindow.sessionStorage.getItem(`${STICKY_RUNTIME_STORAGE_PREFIX}${key}`)?.trim()
      if (value) {
        return value
      }
    } catch {
      return null
    }
  }

  return null
}

function persistUrlOverrides() {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return
  }

  const searchParams = new URLSearchParams(runtimeWindow.location.search)
  for (const key of STICKY_RUNTIME_KEYS) {
    const value = searchParams.get(key)?.trim()
    if (!value) {
      continue
    }

    try {
      runtimeWindow.sessionStorage.setItem(`${STICKY_RUNTIME_STORAGE_PREFIX}${key}`, value)
    } catch {
      return
    }
  }
}

persistUrlOverrides()

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

function rewriteLoopbackUrlForLan(configuredUrl: string, runtimeWindow: RuntimeWindow) {
  try {
    const parsedUrl = new URL(configuredUrl, runtimeWindow.location.origin)
    if (!isLoopbackHostname(parsedUrl.hostname) || isLoopbackHostname(runtimeWindow.location.hostname)) {
      return parsedUrl.toString()
    }

    parsedUrl.hostname = runtimeWindow.location.hostname
    return parsedUrl.toString()
  } catch {
    return configuredUrl
  }
}

function readPlayerProfile() {
  try {
    const userJson = localStorage.getItem('agenstd_auth_user')
    if (!userJson) {
      return null
    }

    return JSON.parse(userJson) as { userId?: string; name?: string }
  } catch {
    return null
  }
}

export function resolveSocketUrl() {
  const runtimeWindow = getRuntimeWindow()
  if (!runtimeWindow) {
    return null
  }

  const configuredUrl = readUrlQueryValue('wsUrl', 'socketUrl')
    ?? readStickyRuntimeValue('wsUrl', 'socketUrl')
    ?? readConfiguredValue('VITE_WS_URL', 'WS_URL')
  if (configuredUrl) {
    return rewriteLoopbackUrlForLan(configuredUrl, runtimeWindow)
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

  const configuredToken = readUrlQueryValue('token', 'gatewayToken')
    ?? readStickyRuntimeValue('token', 'gatewayToken')
    ?? readConfiguredValue('VITE_GATEWAY_TOKEN', 'WS_TOKEN')
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

  const configuredUrl = readUrlQueryValue('apiBaseUrl', 'apiUrl')
    ?? readStickyRuntimeValue('apiBaseUrl', 'apiUrl')
    ?? readConfiguredValue('VITE_API_BASE_URL', 'API_BASE_URL')
  if (configuredUrl) {
    return rewriteLoopbackUrlForLan(configuredUrl, runtimeWindow).replace(/\/$/, '')
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
  const playerProfile = readPlayerProfile()
  if (playerProfile?.userId) {
    return playerProfile.userId
  }

  const configured = readUrlQueryValue('playerId')
    ?? readStickyRuntimeValue('playerId')
    ?? readConfiguredValue('VITE_PLAYER_ID', 'PLAYER_ID')
  if (configured) {
    return configured
  }

  if (import.meta.env.DEV) {
    return 'human-dev'
  }

  return null
}

export function resolvePlayerName(): string | null {
  const playerProfile = readPlayerProfile()
  if (playerProfile?.name) {
    return playerProfile.name
  }

  const configured = readUrlQueryValue('playerName', 'name')
    ?? readStickyRuntimeValue('playerName')
    ?? readConfiguredValue('VITE_PLAYER_NAME', 'PLAYER_NAME')
  if (configured) {
    return configured
  }

  return resolvePlayerId()
}

/**
 * 解析当前玩家类型（'human' | 'agent'）。
 * 优先读取 VITE_PLAYER_KIND；开发环境默认 'human'。
 */
export function resolvePlayerKind(): 'human' | 'agent' {
  const configured = readUrlQueryValue('playerKind')
    ?? readStickyRuntimeValue('playerKind')
    ?? readConfiguredValue('VITE_PLAYER_KIND', 'PLAYER_KIND')
  if (configured === 'agent') {
    return 'agent'
  }

  return 'human'
}