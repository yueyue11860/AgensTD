import { Router } from 'express'
import type { ServerConfig } from '../config/server-config'
import type { SocketGateway } from './socket-gateway'
import { authenticateGatewayToken, extractHttpToken } from './gateway-auth'

export function isE2eControlAvailable(config: Pick<ServerConfig, 'pveE2eEnabled'>, nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== 'production' && config.pveE2eEnabled
}

export function createE2eControlRouter(config: ServerConfig, gateway: SocketGateway) {
  const router = Router()
  const principal = (request: Parameters<typeof extractHttpToken>[0]) => (
    authenticateGatewayToken(config, extractHttpToken(request))
  )
  router.post('/host-loop', (request, response) => {
    if (!isE2eControlAvailable(config)) {
      response.status(404).json({ ok: false, code: 'NOT_FOUND' })
      return
    }
    const identity = principal(request)
    if (!identity) {
      response.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
      return
    }
    const roomId = typeof request.body?.roomId === 'string' ? request.body.roomId : ''
    const intervalMs = typeof request.body?.intervalMs === 'number' ? request.body.intervalMs : Number.NaN
    const result = gateway.setE2eHostLoopInterval(roomId, identity.playerId, intervalMs)
    if (!result.ok) {
      const status = result.code === 'ROOM_NOT_FOUND' ? 404 : result.code === 'ROOM_ACCESS_DENIED' ? 403 : 400
      response.status(status).json(result)
      return
    }
    response.json(result)
  })
  router.get('/renderer-stress', (request, response) => {
    if (!isE2eControlAvailable(config)) return response.status(404).json({ ok: false, code: 'NOT_FOUND' })
    const identity = principal(request)
    if (!identity) return response.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
    response.json({ ok: true, roomId: 'E2E-RENDERER-STRESS', writesAccount: false, createsSettlement: false })
  })
  router.get('/rooms/:roomId/state', (request, response) => {
    if (!isE2eControlAvailable(config)) return response.status(404).json({ ok: false, code: 'NOT_FOUND' })
    const identity = principal(request)
    if (!identity) return response.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
    const state = gateway.getE2eAuthoritativeState(request.params.roomId, identity.playerId)
    if (!state) return response.status(404).json({ ok: false, code: 'ROOM_NOT_FOUND' })
    response.json({ ok: true, state })
  })
  router.post('/rooms/:roomId/actions', async (request, response) => {
    if (!isE2eControlAvailable(config)) return response.status(404).json({ ok: false, code: 'NOT_FOUND' })
    const identity = principal(request)
    if (!identity) return response.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
    const result = await gateway.submitE2eAction(request.params.roomId, identity, request.body)
    response.status(result.status).json(result)
  })
  return router
}
