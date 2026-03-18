import type { Request } from 'express'
import type { Socket } from 'socket.io'
import type { ServerConfig } from '../config/server-config'
import type { PlayerIdentity } from '../domain/actions'
import { getSessionByToken } from './oauth-routes'

export interface GatewayPrincipal extends PlayerIdentity {
  token: string
}

function readAuthorizationToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader) {
    return undefined
  }

  const [scheme, credentials] = authorizationHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !credentials) {
    return undefined
  }

  return credentials
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 尝试从 session token 解析已登录的 OAuth 用户 */
function resolveSessionPrincipal(token: string): GatewayPrincipal | null {
  if (!token.startsWith('sess_')) return null

  const session = getSessionByToken(token)
  if (!session) return null

  return {
    token,
    playerId: session.user.userId,
    playerName: session.user.name || session.user.userId,
    playerKind: 'human',
  }
}

export function authenticateGatewayToken(config: ServerConfig, token: string | undefined) {
  if (!config.authRequired) {
    const fallback = config.authTokens[0]
    if (!fallback) {
      return null
    }

    return {
      token: fallback.token,
      playerId: fallback.playerId,
      playerName: fallback.playerName,
      playerKind: fallback.playerKind,
    } satisfies GatewayPrincipal
  }

  if (!token) {
    return null
  }

  // 优先检查 session token（OAuth 登录用户）
  const sessionPrincipal = resolveSessionPrincipal(token)
  if (sessionPrincipal) return sessionPrincipal

  // 回退到静态 token 匹配（dev/agent token）
  const match = config.authTokens.find((candidate) => candidate.token === token)
  if (!match) {
    return null
  }

  return {
    token: match.token,
    playerId: match.playerId,
    playerName: match.playerName,
    playerKind: match.playerKind,
  } satisfies GatewayPrincipal
}

export function extractHttpToken(request: Request) {
  const headerToken = readAuthorizationToken(request.header('authorization') ?? undefined)
  if (headerToken) {
    return headerToken
  }

  const apiKeyHeader = request.header('x-api-key')
  if (apiKeyHeader) {
    return apiKeyHeader
  }

  if (isRecord(request.body) && typeof request.body.token === 'string') {
    return request.body.token
  }

  return undefined
}

export function extractSocketToken(socket: Socket) {
  const authToken = isRecord(socket.handshake.auth) && typeof socket.handshake.auth.token === 'string'
    ? socket.handshake.auth.token
    : undefined

  if (authToken) {
    return authToken
  }

  const queryToken = socket.handshake.query.token
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken
  }

  const headerAuthorization = socket.handshake.headers.authorization
  if (typeof headerAuthorization === 'string') {
    const bearerToken = readAuthorizationToken(headerAuthorization)
    if (bearerToken) {
      return bearerToken
    }
  }

  const apiKeyHeader = socket.handshake.headers['x-api-key']
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
    return apiKeyHeader
  }

  return undefined
}
