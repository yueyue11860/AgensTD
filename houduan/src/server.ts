import http from 'http'
import cors from 'cors'
import express from 'express'
import { createServerConfig } from './config/server-config'
import { GameEngine } from './core/game-engine'
import { GameLoop } from './core/game-loop'
import { ActionRateLimiter } from './network/action-rate-limiter'
import { createRestApiRouter } from './network/rest-api'
import { SocketGateway } from './network/socket-gateway'

const config = createServerConfig()
const app = express()

app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true }))
app.use(express.json())

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'agenstd-houduan',
    port: config.port,
    tickRateMs: config.tickRateMs,
  })
})

const httpServer = http.createServer(app)
const engine = new GameEngine(config)
const loop = new GameLoop(engine, config.tickRateMs)
const actionLimiter = new ActionRateLimiter(config.actionRateLimitWindowMs, config.actionRateLimitMax)
const gateway = new SocketGateway(httpServer, engine, config, actionLimiter)

app.use('/api', createRestApiRouter(engine, config, actionLimiter))

httpServer.listen(config.port, () => {
  loop.start()
})

const shutdown = () => {
  loop.stop()
  gateway.io.close(() => {
    httpServer.close(() => {
      process.exit(0)
    })
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)