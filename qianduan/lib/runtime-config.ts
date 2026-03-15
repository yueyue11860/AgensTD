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