import { useCallback, useEffect, useState } from 'react'
import { resolveApiBaseUrl } from '../lib/runtime-config'

export interface AuthUser {
  userId: string
  name: string
  avatar: string
}

interface AuthState {
  user: AuthUser | null
  sessionToken: string | null
  isLoading: boolean
}

const SESSION_TOKEN_KEY = 'agenstd_session_token'
const AUTH_USER_KEY = 'agenstd_auth_user'

function loadPersistedSession(): { token: string | null; user: AuthUser | null } {
  try {
    const token = localStorage.getItem(SESSION_TOKEN_KEY)
    const userJson = localStorage.getItem(AUTH_USER_KEY)
    const user = userJson ? (JSON.parse(userJson) as AuthUser) : null
    return { token, user }
  } catch {
    return { token: null, user: null }
  }
}

function persistSession(token: string, user: AuthUser) {
  localStorage.setItem(SESSION_TOKEN_KEY, token)
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
}

function clearPersistedSession() {
  localStorage.removeItem(SESSION_TOKEN_KEY)
  localStorage.removeItem(AUTH_USER_KEY)
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const persisted = loadPersistedSession()
    return {
      user: persisted.user,
      sessionToken: persisted.token,
      isLoading: !!persisted.token,
    }
  })

  const apiBase = resolveApiBaseUrl()

  // 启动时用 session token 验证会话是否仍有效
  useEffect(() => {
    if (!state.sessionToken || !apiBase) {
      setState((prev) => ({ ...prev, isLoading: false }))
      return
    }

    let cancelled = false

    fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${state.sessionToken}` },
    })
      .then((res) => res.json())
      .then((json: Record<string, unknown>) => {
        if (cancelled) return
        if (json.ok && json.user) {
          const user = json.user as AuthUser
          setState({ user, sessionToken: state.sessionToken, isLoading: false })
          persistSession(state.sessionToken!, user)
        } else {
          clearPersistedSession()
          setState({ user: null, sessionToken: null, isLoading: false })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoading: false }))
        }
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 发起 OAuth 登录：获取授权 URL 并跳转 */
  const login = useCallback(async () => {
    if (!apiBase) return

    const res = await fetch(`${apiBase}/auth/login`)
    const json = (await res.json()) as { ok: boolean; authorizeUrl?: string; state?: string }
    if (json.ok && json.authorizeUrl) {
      // 保存 state 用于 CSRF 校验
      if (json.state) {
        sessionStorage.setItem('oauth_state', json.state)
      }
      window.location.href = json.authorizeUrl
    }
  }, [apiBase])

  /** 用回调中的 code 换取 session */
  const exchangeCode = useCallback(async (code: string): Promise<boolean> => {
    if (!apiBase) return false

    const res = await fetch(`${apiBase}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    const json = (await res.json()) as {
      ok: boolean
      sessionToken?: string
      user?: AuthUser
    }

    if (json.ok && json.sessionToken && json.user) {
      persistSession(json.sessionToken, json.user)
      setState({ user: json.user, sessionToken: json.sessionToken, isLoading: false })
      return true
    }
    return false
  }, [apiBase])

  /** 登出 */
  const logout = useCallback(async () => {
    if (apiBase && state.sessionToken) {
      await fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.sessionToken}` },
      }).catch(() => {})
    }
    clearPersistedSession()
    setState({ user: null, sessionToken: null, isLoading: false })
  }, [apiBase, state.sessionToken])

  return {
    user: state.user,
    sessionToken: state.sessionToken,
    isLoading: state.isLoading,
    isLoggedIn: !!state.user,
    login,
    exchangeCode,
    logout,
  }
}
