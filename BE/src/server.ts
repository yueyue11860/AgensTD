import 'dotenv/config'
import http from 'http'
import path from 'path'
import { existsSync } from 'fs'
import cors from 'cors'
import express from 'express'
import { createServerConfig } from './config/server-config'
import { RoomManager } from './core/Room'
import { GameLoop } from './core/game-loop'
import { PerformanceTelemetry } from './core/performance-telemetry'
import { ProjectedTickStream } from './core/projected-tick-stream'
import { ReplayRecorder } from './core/replay-recorder'
import { SupabaseCompetitionStore } from './data/supabase-competition-store'
import { ActionRateLimiter } from './network/action-rate-limiter'
import { createAgentApiRouter } from './network/agent-api'
import { createRestApiRouter } from './network/rest-api'
import { SocketGateway } from './network/socket-gateway'
import { ProgressStore } from './data/progress-store'

const config = createServerConfig()
const app = express()
const frontendDistDir = path.resolve(process.cwd(), '../FE/dist')
const frontendIndexFile = path.join(frontendDistDir, 'index.html')
const hasFrontendBuild = existsSync(frontendIndexFile)

function isFrontendPageRequest(request: express.Request) {
  if (request.path.startsWith('/api') || request.path.startsWith('/health') || request.path.startsWith('/socket.io')) {
    return false
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false
  }

  if (path.extname(request.path)) {
    return false
  }

  const acceptHeader = request.headers.accept ?? ''
  return acceptHeader.includes('text/html')
}

app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true }))
app.use(express.json())

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir))
}

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
const performanceTelemetry = new PerformanceTelemetry()
engine.attachPerformanceTelemetry(performanceTelemetry)
const loop = new GameLoop(engine, config.tickRateMs)
const competitionStore = new SupabaseCompetitionStore(config)
const projectedTickStream = new ProjectedTickStream(engine, config, performanceTelemetry)
const replayRecorder = new ReplayRecorder(engine, projectedTickStream, config, competitionStore, performanceTelemetry)
const actionLimiter = new ActionRateLimiter(config.actionRateLimitWindowMs, config.actionRateLimitMax)
const progressStore = new ProgressStore()
const gateway = new SocketGateway(httpServer, room, config, projectedTickStream, performanceTelemetry, actionLimiter, progressStore)

app.use('/api', createRestApiRouter(engine, config, actionLimiter, replayRecorder, competitionStore, progressStore))
app.use('/api/agent', createAgentApiRouter(projectedTickStream, config, replayRecorder, competitionStore, performanceTelemetry))

if (hasFrontendBuild) {
  app.use((request, response, next) => {
    if (!isFrontendPageRequest(request)) {
      next()
      return
    }

    response.sendFile(frontendIndexFile)
  })
}

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