import type { Session, User } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { clearRuntimeAuthSession, setRuntimeAuthSession } from '../lib/auth-session-bridge'
import { resolveApiBaseUrl } from '../lib/runtime-config'
import { getSupabaseBrowserClient } from '../lib/supabase-browser'

export interface AuthUser {
  userId: string
  name: string
  avatar: string
  email?: string
}

interface AuthState {
  user: AuthUser | null
  sessionToken: string | null
  isLoading: boolean
  error: string | null
}

export interface AuthActionResult {
  ok: boolean
  error?: string
  needsEmailConfirmation?: boolean
}

function userFromSupabase(user: User): AuthUser {
  const metadata = user.user_metadata ?? {}
  const email = user.email ?? undefined
  return {
    userId: user.id,
    name: String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? email?.split('@')[0] ?? user.id),
    avatar: String(metadata.avatar_url ?? metadata.picture ?? ''),
    email,
  }
}

async function verifyWithGameServer(session: Session, apiBase: string | null) {
  const fallbackUser = userFromSupabase(session.user)
  if (!apiBase) return fallbackUser

  const response = await fetch(`${apiBase}/auth/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; user?: AuthUser; message?: string } | null
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? '游戏服务器未接受当前登录会话')
  }
  return payload.user ?? fallbackUser
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    sessionToken: null,
    isLoading: true,
    error: null,
  })
  const apiBase = resolveApiBaseUrl()
  const supabase = getSupabaseBrowserClient()

  useEffect(() => {
    if (!supabase) {
      clearRuntimeAuthSession()
      setState({
        user: null,
        sessionToken: null,
        isLoading: false,
        error: '缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY',
      })
      return
    }

    let cancelled = false
    let revision = 0

    const applySession = async (session: Session | null) => {
      const currentRevision = ++revision
      if (!session) {
        clearRuntimeAuthSession()
        if (!cancelled) setState({ user: null, sessionToken: null, isLoading: false, error: null })
        return
      }

      try {
        const user = await verifyWithGameServer(session, apiBase)
        if (cancelled || currentRevision !== revision) return
        setRuntimeAuthSession(session.access_token, user)
        setState({ user, sessionToken: session.access_token, isLoading: false, error: null })
      } catch (error) {
        if (cancelled || currentRevision !== revision) return
        clearRuntimeAuthSession()
        setState({
          user: null,
          sessionToken: null,
          isLoading: false,
          error: error instanceof Error ? error.message : '登录会话验证失败',
        })
      }
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        clearRuntimeAuthSession()
        setState({ user: null, sessionToken: null, isLoading: false, error: error.message })
        return
      }
      void applySession(data.session)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [apiBase, supabase])

  const login = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    if (!supabase) return { ok: false, error: 'Supabase 登录尚未配置' }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    return error ? { ok: false, error: error.message } : { ok: true }
  }, [supabase])

  const register = useCallback(async (name: string, email: string, password: string): Promise<AuthActionResult> => {
    if (!supabase) return { ok: false, error: 'Supabase 登录尚未配置' }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() || email.split('@')[0] } },
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, needsEmailConfirmation: !data.session }
  }, [supabase])

  const logout = useCallback(async () => {
    clearRuntimeAuthSession()
    setState({ user: null, sessionToken: null, isLoading: false, error: null })
    if (supabase) await supabase.auth.signOut().catch(() => undefined)
  }, [supabase])

  return {
    user: state.user,
    sessionToken: state.sessionToken,
    isLoading: state.isLoading,
    isLoggedIn: !!state.user,
    error: state.error,
    login,
    register,
    logout,
  }
}
