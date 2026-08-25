import { Router } from 'express'
import type { ServerConfig } from '../config/server-config'
import type { UserStore } from '../data/user-store'
import { authenticateGatewayTokenAsync, extractHttpToken } from './gateway-auth'

export function createSupabaseAuthRouter(config: ServerConfig, userStore: UserStore) {
  const router = Router()

  router.get('/auth/me', async (request, response) => {
    const principal = await authenticateGatewayTokenAsync({ ...config, authRequired: true }, extractHttpToken(request))
    if (!principal || principal.playerKind !== 'human' || principal.authSource !== 'supabase') {
      response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid Supabase access token' })
      return
    }

    const user = {
      userId: principal.playerId,
      name: principal.playerName,
      email: principal.email ?? '',
      avatar: principal.avatar ?? '',
      bio: '',
      route: '',
    }
    await userStore.upsertUser(user)
    await userStore.getOrCreateProgress(user.userId, 'HUMAN')
    response.json({ ok: true, user })
  })

  return router
}
