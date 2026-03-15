import { Router, type Request, type Response } from 'express'
import { projectFrontendGameState } from '../core/state-projection'
import { GameEngine } from '../core/game-engine'
import type { ServerConfig } from '../config/server-config'
import { submitAction } from './action-submission'
import { ActionRateLimiter } from './action-rate-limiter'
import { authenticateGatewayToken, extractHttpToken } from './gateway-auth'

function resolvePrincipal(request: Request, config: ServerConfig) {
  return authenticateGatewayToken(config, extractHttpToken(request))
}

function rejectUnauthorized(response: Response) {
  response.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid gateway token' })
}

export function createRestApiRouter(engine: GameEngine, config: ServerConfig, limiter: ActionRateLimiter) {
  const router = Router()

  router.get('/state', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    response.json({
      ok: true,
      player: {
        playerId: principal.playerId,
        playerName: principal.playerName,
        playerKind: principal.playerKind,
      },
      gameState: projectFrontendGameState(engine.getStateSnapshot(), config),
    })
  })

  router.post('/actions', (request, response) => {
    const principal = resolvePrincipal(request, config)
    if (!principal) {
      rejectUnauthorized(response)
      return
    }

    const submission = submitAction({
      engine,
      limiter,
      player: principal,
      payload: request.body,
    })

    if (!submission.ok) {
      response.status(submission.status).json({
        ok: false,
        code: submission.code,
        message: submission.message,
        retryAfterMs: submission.retryAfterMs,
      })
      return
    }

    response.status(202).json({
      ok: true,
      accepted: true,
      action: submission.action,
      rateLimitRemaining: submission.rateLimitRemaining,
      gameState: projectFrontendGameState(engine.getStateSnapshot(), config),
    })
  })

  return router
}