import 'dotenv/config'
import http from 'http'
import path from 'path'
import { existsSync } from 'fs'
import cors from 'cors'
import express from 'express'
import { createServerConfig } from './config/server-config'
import { resolvePersistencePolicy, resolvePveCheckpointStoreMode, resolvePveRewardStoreMode } from './config/production-policy'
import { configureSupabaseAuthVerifier, SupabaseAuthVerifier } from './auth/supabase-auth'
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
import { createSupabaseAuthRouter } from './network/supabase-auth-routes'
import { createE2eControlRouter } from './network/e2e-control-api'
import { SocketGateway } from './network/socket-gateway'
import { PvpPlatformService } from './pvp-platform-v1'
import { PvpRewardOutboxWorker } from './pvp-platform-v1/outbox-worker'
import { ProgressStore } from './data/progress-store'
import { SupabaseUserStore } from './data/supabase-user-store'
import { PlayerAccountService } from './account-v1'
import { MemoryPlayerAccountStore } from './account-v1/memory-store'
import { SupabasePlayerAccountStore } from './data/supabase-player-account-store'
import { ResilientPlayerAccountStore } from './data/resilient-player-account-store'
import { SupabasePveRewardStore } from './data/supabase-pve-reward-store'
import { isPersistenceReadyForTraffic, PersistenceReadinessTracker, probeSupabaseWrite } from './data/persistence-readiness'
import { MemoryPveRewardStore, PveRewardService, PveSettlementCoordinator } from './pve-reward-v1'
import { MemoryPveCheckpointStore, PveCheckpointCoordinator } from './pve-checkpoint-v1'
import { SupabasePveCheckpointStore } from './data/supabase-pve-checkpoint-store'
import {
  V1AccountShopCatalog,
  V1MatchBuildDefinitionResolver,
} from './data/player-account-adapters'

const config = createServerConfig()
const isProduction = process.env.NODE_ENV === 'production'
const persistencePolicy = resolvePersistencePolicy({
  nodeEnv: process.env.NODE_ENV,
  pvpStore: process.env.PVP_STORE,
  hasSupabaseCredentials: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
})
const persistenceReadiness = new PersistenceReadinessTracker(
  persistencePolicy.requiresWritablePersistence || persistencePolicy.pvpStoreMode === 'supabase'
    ? 'supabase'
    : 'memory',
)
let pveCheckpointReadiness: { status: 'checking' | 'ready' | 'not_ready'; code: string | null; recovered: boolean } = {
  status: 'checking', code: null, recovered: false,
}
let gateway: SocketGateway | null = null
const checkpointStoreMode = resolvePveCheckpointStoreMode(process.env.NODE_ENV, process.env.PVE_CHECKPOINT_STORE)
const supabaseCheckpointStore = new SupabasePveCheckpointStore(config)
if (checkpointStoreMode === 'supabase' && !supabaseCheckpointStore.isEnabled()) {
  throw new Error('PVE_CHECKPOINT_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}
const pveCheckpointStore = checkpointStoreMode === 'supabase'
  ? supabaseCheckpointStore
  : new MemoryPveCheckpointStore()
const pveCheckpointCoordinator = new PveCheckpointCoordinator(pveCheckpointStore, {
  checkpointEveryTicks: (() => {
    const configured = Number(process.env.PVE_CHECKPOINT_EVERY_TICKS ?? 50)
    return Number.isFinite(configured) ? Math.max(1, Math.round(configured)) : 50
  })(),
  onFatal: () => {
    pveCheckpointReadiness = { status: 'not_ready', code: 'PVE_CHECKPOINT_UNHEALTHY', recovered: pveCheckpointReadiness.recovered }
    gateway?.stopRoomLoops()
  },
})
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
  const persistence = persistenceReadiness.snapshot()
  const ok = isPersistenceReadyForTraffic(persistence, persistencePolicy.requiresWritablePersistence)
    && pveCheckpointReadiness.status === 'ready'
  response.status(ok ? 200 : 503).json({
    ok,
    service: 'agenstd-houduan',
    persistence,
    stores: {
      auth: config.supabaseUrl && config.supabaseServiceRoleKey ? 'supabase' : 'static',
      pvp: persistencePolicy.pvpStoreMode,
      pveCheckpoint: checkpointStoreMode,
    },
    pveCheckpoint: pveCheckpointReadiness,
  })
})

const httpServer = http.createServer(app)
const supabaseAccountStore = new SupabasePlayerAccountStore(config)
if (isProduction && !supabaseAccountStore.isEnabled()) {
  throw new Error('Production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for player accounts')
}
const accountStore = isProduction
  ? supabaseAccountStore
  : new ResilientPlayerAccountStore(supabaseAccountStore, new MemoryPlayerAccountStore())
const accountBuildResolver = new V1MatchBuildDefinitionResolver()
const accountService = new PlayerAccountService(accountStore, new V1AccountShopCatalog())
const rewardStoreMode = resolvePveRewardStoreMode(process.env.NODE_ENV, process.env.PVE_REWARD_STORE)
const supabaseRewardStore = new SupabasePveRewardStore(config)
if (rewardStoreMode === 'supabase' && !supabaseRewardStore.isEnabled()) {
  throw new Error('PVE_REWARD_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}
const pveRewardStore = rewardStoreMode === 'supabase' ? supabaseRewardStore : new MemoryPveRewardStore()
const pveRewardService = new PveRewardService(pveRewardStore)
const pveSettlementCoordinator = new PveSettlementCoordinator(pveRewardStore, accountService)
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
const supabaseAuthVerifier = new SupabaseAuthVerifier(config)
configureSupabaseAuthVerifier(supabaseAuthVerifier)
if (isProduction && (!supabaseAuthVerifier.isEnabled() || !userStore.isEnabled())) {
  throw new Error('Production Supabase Auth requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}
const pvpStore = persistencePolicy.pvpStoreMode === 'supabase' ? new SupabasePvpStore(config) : new MemoryPvpStore()
const pvpPlatform = new PvpPlatformService({ store: pvpStore })
const pvpRewardWorker = new PvpRewardOutboxWorker(pvpStore)
gateway = new SocketGateway(
  httpServer,
  roomManager,
  config,
  performanceTelemetry,
  actionLimiter,
  progressStore,
  projectedTickStream,
  accountService,
  pveRewardService,
  pveSettlementCoordinator,
  pveCheckpointCoordinator,
  true,
)

app.use('/api', createSupabaseAuthRouter(config, userStore))
app.use('/api/e2e', createE2eControlRouter(config, gateway))
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
  pveRewardStore,
  pveCheckpointCoordinator,
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

void Promise.all([
  pveSettlementCoordinator.recover(),
  persistenceReadiness.snapshot().mode === 'supabase'
    ? probeSupabaseWrite(config)
    : Promise.resolve({ status: 'ready' as const, writable: true, checkedAt: new Date().toISOString(), code: null }),
  (async () => {
    // Ask for one sentinel beyond the supported room budget. Silently omitting an older active
    // room would advertise readiness while abandoning its authoritative match.
    const latest = await pveCheckpointStore.listLatestCheckpoints(1001)
    if (latest.length > 1000) throw new Error('PVE_CHECKPOINT_DISCOVERY_ROOM_LIMIT_EXCEEDED')
    const roomIds = new Set(latest.flatMap((checkpoint) => {
      const engineState = (checkpoint.payload.engine as { state?: { status?: unknown } } | undefined)?.state
      return engineState?.status === 'finished' ? [] : [checkpoint.roomId]
    }))
    const results = await Promise.all([...roomIds].map((roomId) => (
      pveCheckpointCoordinator.recoverAndAttach(roomManager.getOrCreateRoom(roomId))
    )))
    return {
      recovered: results.some((result) => result.recovered),
      recoveredRooms: results.filter((result) => result.recovered).length,
      replayedActions: results.reduce((total, result) => total + result.replayedActions, 0),
    }
  })(),
])
  .then(([{ recovered, failed }, persistenceProbe, checkpointRecovery]) => {
    persistenceReadiness.mark(persistenceProbe)
    if (persistenceProbe.status !== 'ready' || !persistenceProbe.writable) {
      throw new Error(`Persistence readiness failed: ${persistenceProbe.code ?? 'NOT_WRITABLE'}`)
    }
    pveCheckpointReadiness = { status: 'ready', code: null, recovered: checkpointRecovery.recovered }
    if (recovered > 0 || failed > 0) console.info(`PVE settlement recovery: recovered=${recovered} failed=${failed}`)
    if (isProduction && failed > 0) throw new Error(`PVE settlement recovery left ${failed} failed record(s)`)
    gateway!.prepareRoomRuntimes()
    gateway!.startRoomLoops()
    void pvpPlatform.ready.then(() => pvpRewardWorker.start())
    httpServer.listen(config.port, () => {})
  })
  .catch((error: unknown) => {
    const details = error instanceof Error ? error.message : String(error)
    persistenceReadiness.mark({ status: 'not_ready', writable: false, checkedAt: new Date().toISOString(), code: 'BOOTSTRAP_FAILED' })
    pveCheckpointReadiness = { status: 'not_ready', code: 'BOOTSTRAP_FAILED', recovered: false }
    console.error(`Persistence bootstrap failed; refusing to listen: ${details}`)
    pvpPlatform.shutdown()
    void pvpRewardWorker.stop()
    gateway!.shutdown(() => { process.exitCode = 1 })
  })

const shutdown = () => {
  pvpPlatform.shutdown()
  void pvpRewardWorker.stop()
  pveCheckpointCoordinator.shutdown()
  void replayRecorder.flushLatest()
    .catch((error: unknown) => {
      const details = error instanceof Error ? error.message : String(error)
      console.error(`Final replay persistence failed during shutdown: ${details}`)
    })
    .finally(() => {
      gateway!.shutdown(() => {
        httpServer.close(() => {
          process.exit(0)
        })
      })
    })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
