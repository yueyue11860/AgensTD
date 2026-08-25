export interface RuntimeAuthIdentity {
  userId: string
  name: string
  avatar: string
  email?: string
}

const ACCESS_TOKEN_KEY = 'agenstd_supabase_access_token'
const IDENTITY_KEY = 'agenstd_supabase_identity'

let currentAccessToken: string | null = null
let currentIdentity: RuntimeAuthIdentity | null = null

export function setRuntimeAuthSession(accessToken: string, identity: RuntimeAuthIdentity) {
  currentAccessToken = accessToken
  currentIdentity = identity
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
  } catch {
    // Module memory still keeps the active session when storage is unavailable.
  }
}

export function clearRuntimeAuthSession() {
  currentAccessToken = null
  currentIdentity = null
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(IDENTITY_KEY)
  } catch {
    // Ignore browser storage failures during logout.
  }
}

export function getRuntimeAccessToken() {
  if (currentAccessToken) return currentAccessToken
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

export function getRuntimeAuthIdentity() {
  if (currentIdentity) return currentIdentity
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RuntimeAuthIdentity
    return parsed?.userId ? parsed : null
  } catch {
    return null
  }
}
