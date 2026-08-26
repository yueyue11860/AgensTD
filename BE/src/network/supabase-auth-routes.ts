import { Router } from 'express'
import type { ServerConfig } from '../config/server-config'
import type { UserStore } from '../data/user-store'
import { authenticateGatewayTokenAsync, extractHttpToken } from './gateway-auth'

export function createSupabaseAuthRouter(config: ServerConfig, userStore: UserStore) {
  const router = Router()

  router.get('/auth/me', async (request, response) => {
    const principal = await authenticateGatewayTokenAsync({ ...config, authRequired: true }, extractHttpToken(request))
    const acceptedAuthSource = principal?.authSource === 'supabase'
      || (process.env.NODE_ENV !== 'production' && principal?.authSource === 'static')
    if (!principal || principal.playerKind !== 'human' || !acceptedAuthSource) {
      response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid access token' })
      return
    }

    const user = {
      userId: principal.playerId,
      name: principal.playerName,
      email: principal.authSource === 'supabase' ? principal.email ?? '' : '',
      avatar: principal.authSource === 'supabase' ? principal.avatar ?? '' : '',
      bio: '',
      route: '',
    }
    if (principal.authSource === 'supabase') {
      await userStore.upsertUser(user)
      await userStore.getOrCreateProgress(user.userId, 'HUMAN')
    }
    response.json({ ok: true, user })
  })

  return router
}
