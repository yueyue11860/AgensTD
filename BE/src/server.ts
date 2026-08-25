import 'dotenv/config'
import http from 'http'
import path from 'path'
import { existsSync } from 'fs'
import cors from 'cors'
import express from 'express'
import { createServerConfig } from './config/server-config'
import { RoomManager } from './core/Room'
import { PerformanceTelemetry } from './core/performance-telemetry'
import { ProjectedTickStream } from './core/projected-tick-stream'
import { ReplayRecorder } from './core/replay-recorder'
import { SupabaseCompetitionStore } from './data/supabase-competition-store'
import { MemoryPvpStore } from './data/memory-pvp-store'
import { SupabasePvpStore } from './data/supabase-pvp-store'
import { ActionRateLimiter } from './network/action-rate-limiter'
import { createAgentApiRouter } from './network/agent-api'
import { createRestApiRouter } from './network/rest-api'
import { createPvpRestApiRouter } from './network/pvp-rest-api'
import { createOAuthRouter } from './network/oauth-routes'
import { SocketGateway } from './network/socket-gateway'
import { PvpPlatformService } from './pvp-platform-v1'
import { ProgressStore } from './data/progress-store'
import { SupabaseUserStore } from './data/supabase-user-store'
import { PlayerAccountService } from './account-v1'
import { MemoryPlayerAccountStore } from './account-v1/memory-store'
import { SupabasePlayerAccountStore } from './data/supabase-player-account-store'
import { ResilientPlayerAccountStore } from './data/resilient-player-account-store'
import {
  V1AccountShopCatalog,
  V1MatchBuildDefinitionResolver,
} from './data/player-account-adapters'

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
const accountStore = new ResilientPlayerAccountStore(
  new SupabasePlayerAccountStore(config),
  new MemoryPlayerAccountStore(),
)
const accountBuildResolver = new V1MatchBuildDefinitionResolver()
const accountService = new PlayerAccountService(accountStore, new V1AccountShopCatalog())
const roomManager = new RoomManager(config, {
  accountService,
  buildResolver: accountBuildResolver,
})
const room = roomManager.getOrCreateRoom('public-1')
const engine = room.engine
const performanceTelemetry = new PerformanceTelemetry()
engine.attachPerformanceTelemetry(performanceTelemetry)
const competitionStore = new SupabaseCompetitionStore(config)
const projectedTickStream = new ProjectedTickStream(engine, config, performanceTelemetry)
const replayRecorder = new ReplayRecorder(engine, projectedTickStream, config, competitionStore, performanceTelemetry)
const actionLimiter = new ActionRateLimiter(config.actionRateLimitWindowMs, config.actionRateLimitMax)
const progressStore = new ProgressStore()
const userStore = new SupabaseUserStore(config)
progressStore.setUserStore(userStore)
// 本地默认内存，避免仅因 .env 中存在 Supabase 凭据就误写远端。
// 正式持久化必须显式设置 PVP_STORE=supabase；凭据缺失时直接拒绝启动，不静默丢战绩。
const pvpStoreMode = (process.env.PVP_STORE ?? 'memory').trim().toLowerCase()
if (pvpStoreMode !== 'memory' && pvpStoreMode !== 'supabase') {
  throw new Error(`Unsupported PVP_STORE=${pvpStoreMode}; expected memory or supabase`)
}
if (pvpStoreMode === 'supabase' && (!config.supabaseUrl || !config.supabaseServiceRoleKey)) {
  throw new Error('PVP_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}
const pvpStore = pvpStoreMode === 'supabase' ? new SupabasePvpStore(config) : new MemoryPvpStore()
const pvpPlatform = new PvpPlatformService({ store: pvpStore })
const gateway = new SocketGateway(
  httpServer,
  roomManager,
  config,
  performanceTelemetry,
  actionLimiter,
  progressStore,
  projectedTickStream,
)

app.use('/api', createOAuthRouter(config, userStore))
app.use('/api/pvp', createPvpRestApiRouter(config, pvpPlatform))
app.use('/api', createRestApiRouter(
  engine,
  roomManager,
  config,
  actionLimiter,
  replayRecorder,
  competitionStore,
  progressStore,
  accountService,
))
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
})

const shutdown = () => {
  pvpPlatform.shutdown()
  void replayRecorder.flushLatest()
    .catch((error: unknown) => {
      const details = error instanceof Error ? error.message : String(error)
      console.error(`Final replay persistence failed during shutdown: ${details}`)
    })
    .finally(() => {
      gateway.shutdown(() => {
        httpServer.close(() => {
          process.exit(0)
        })
      })
    })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
