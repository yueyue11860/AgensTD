import crypto from 'crypto'
import { Router, type Request, type Response } from 'express'
import type { ServerConfig } from '../config/server-config'
import type { SupabaseUserStore } from '../data/supabase-user-store'
import type { SecondMeUser, UserSession } from '../domain/user'

const SECONDME_BASE_URL = 'https://api.mindverse.com/gate/lab'

/** 内存会话存储：sessionToken → UserSession */
const sessions = new Map<string, UserSession>()

function generateSessionToken(): string {
  return `sess_${crypto.randomBytes(32).toString('hex')}`
}

/** 根据 session token 查找会话 */
export function getSessionByToken(token: string): UserSession | undefined {
  return sessions.get(token)
}

/** 用授权码交换 access_token */
async function exchangeCodeForTokens(
  code: string,
  config: ServerConfig,
): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string[]
} | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauthRedirectUri,
    client_id: config.oauthClientId,
    client_secret: config.oauthClientSecret,
  })

  const response = await fetch(`${SECONDME_BASE_URL}/api/oauth/token/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    console.error('Token exchange HTTP error:', response.status)
    return null
  }

  const json = (await response.json()) as Record<string, unknown>
  if (json.code !== 0 || !json.data) {
    console.error('Token exchange API error:', json)
    return null
  }

  const data = json.data as Record<string, unknown>
  return {
    accessToken: data.accessToken as string,
    refreshToken: data.refreshToken as string,
    expiresIn: data.expiresIn as number,
    scope: data.scope as string[],
  }
}

/** 使用 access_token 获取用户信息 */
async function fetchSecondMeUser(accessToken: string): Promise<SecondMeUser | null> {
  const response = await fetch(`${SECONDME_BASE_URL}/api/secondme/user/info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    console.error('User info HTTP error:', response.status)
    return null
  }

  const json = (await response.json()) as Record<string, unknown>
  if (json.code !== 0 || !json.data) {
    console.error('User info API error:', json)
    return null
  }

  const data = json.data as Record<string, unknown>
  return {
    userId: String(data.userId ?? ''),
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    avatar: String(data.avatar ?? ''),
    bio: String(data.bio ?? ''),
    route: String(data.route ?? ''),
  }
}

/** 用 refresh_token 刷新 access_token */
async function refreshAccessToken(
  refreshToken: string,
  config: ServerConfig,
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.oauthClientId,
    client_secret: config.oauthClientSecret,
  })

  const response = await fetch(`${SECONDME_BASE_URL}/api/oauth/token/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) return null

  const json = (await response.json()) as Record<string, unknown>
  if (json.code !== 0 || !json.data) return null

  const data = json.data as Record<string, unknown>
  return {
    accessToken: data.accessToken as string,
    expiresIn: data.expiresIn as number,
  }
}

export function createOAuthRouter(config: ServerConfig, userStore: SupabaseUserStore) {
  const router = Router()

  /**
   * GET /auth/login — 返回 SecondMe OAuth 授权 URL
   * 前端使用此 URL 做重定向
   */
  router.get('/auth/login', (_request: Request, response: Response) => {
    const state = crypto.randomBytes(16).toString('hex')
    const authorizeUrl = new URL('https://go.second.me/oauth/')
    authorizeUrl.searchParams.set('client_id', config.oauthClientId)
    authorizeUrl.searchParams.set('redirect_uri', config.oauthRedirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('state', state)

    response.json({ ok: true, authorizeUrl: authorizeUrl.toString(), state })
  })

  /**
   * POST /auth/exchange — 用授权码换 session
   * 前端回调页把 code 发过来，后端做全部交换工作
   */
  router.post('/auth/exchange', async (request: Request, response: Response) => {
    const body = request.body as Record<string, unknown> | undefined
    const code = typeof body?.code === 'string' ? body.code : ''
    if (!code) {
      response.status(400).json({ ok: false, code: 'MISSING_CODE', message: 'Authorization code is required' })
      return
    }

    // Step 1: 用 code 换 token
    const tokens = await exchangeCodeForTokens(code, config)
    if (!tokens) {
      response.status(502).json({ ok: false, code: 'TOKEN_EXCHANGE_FAILED', message: 'Failed to exchange authorization code' })
      return
    }

    // Step 2: 用 access_token 拿用户信息
    const user = await fetchSecondMeUser(tokens.accessToken)
    if (!user || !user.userId) {
      response.status(502).json({ ok: false, code: 'USER_FETCH_FAILED', message: 'Failed to fetch user info' })
      return
    }

    // Step 3: 写入 Supabase
    await userStore.upsertUser(user)
    await userStore.getOrCreateProgress(user.userId, 'HUMAN')

    // Step 4: 创建本地会话
    const sessionToken = generateSessionToken()
    const session: UserSession = {
      sessionToken,
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    }
    sessions.set(sessionToken, session)

    response.json({
      ok: true,
      sessionToken,
      user: {
        userId: user.userId,
        name: user.name,
        avatar: user.avatar,
      },
    })
  })

  /**
   * GET /auth/me — 获取当前登录用户信息和游戏进度
   */
  router.get('/auth/me', async (request: Request, response: Response) => {
    const token = extractSessionToken(request)
    const session = token ? sessions.get(token) : undefined

    if (!session) {
      response.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED', message: 'No valid session' })
      return
    }

    // 检查 access_token 是否快过期，自动刷新
    if (session.expiresAt - Date.now() < 300_000) {
      const refreshed = await refreshAccessToken(session.refreshToken, config)
      if (refreshed) {
        session.accessToken = refreshed.accessToken
        session.expiresAt = Date.now() + refreshed.expiresIn * 1000
      }
    }

    const progress = await userStore.getOrCreateProgress(session.user.userId, 'HUMAN')

    response.json({
      ok: true,
      user: {
        userId: session.user.userId,
        name: session.user.name,
        email: session.user.email,
        avatar: session.user.avatar,
      },
      progress,
    })
  })

  /**
   * POST /auth/logout — 清除会话
   */
  router.post('/auth/logout', (request: Request, response: Response) => {
    const token = extractSessionToken(request)
    if (token) {
      sessions.delete(token)
    }
    response.json({ ok: true })
  })

  return router
}

function extractSessionToken(request: Request): string | undefined {
  const authHeader = request.header('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return undefined
}
