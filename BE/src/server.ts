import 'dotenv/config'
import http from 'http'
import cors from 'cors'
import express from 'express'
import { createServerConfig } from './config/server-config'
import { RoomManager } from './core/Room'
import { GameLoop } from './core/game-loop'
import { ReplayRecorder } from './core/replay-recorder'
import { SupabaseCompetitionStore } from './data/supabase-competition-store'
import { ActionRateLimiter } from './network/action-rate-limiter'
import { createAgentApiRouter } from './network/agent-api'
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
const roomManager = new RoomManager(config)
const room = roomManager.getOrCreateRoom('public-1')
const engine = room.engine
const loop = new GameLoop(engine, config.tickRateMs)
const competitionStore = new SupabaseCompetitionStore(config)
const replayRecorder = new ReplayRecorder(engine, config, competitionStore)
const actionLimiter = new ActionRateLimiter(config.actionRateLimitWindowMs, config.actionRateLimitMax)
const gateway = new SocketGateway(httpServer, room, config, actionLimiter)

app.use('/api', createRestApiRouter(engine, config, actionLimiter, replayRecorder, competitionStore))
app.use('/api/agent', createAgentApiRouter(engine, config, replayRecorder, competitionStore))

httpServer.listen(config.port, () => {
  loop.start()
})

const shutdown = () => {
  loop.stop()
  void replayRecorder.flushLatest().finally(() => {
    gateway.io.close(() => {
      httpServer.close(() => {
        process.exit(0)
      })
    })
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)