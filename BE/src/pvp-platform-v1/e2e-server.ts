import http from 'node:http'
import cors from 'cors'
import express from 'express'
import { createServerConfig } from '../config/server-config'
import { MemoryPvpStore } from '../data/memory-pvp-store'
import { createPvpRestApiRouter } from '../network/pvp-rest-api'
import { PvpPlatformService } from './service'

if (process.env.PVP_E2E_ENABLED !== 'true' || process.env.NODE_ENV === 'production') {
  throw new Error('PVP_E2E_SERVER_FORBIDDEN')
}

const port = Number(process.env.PVP_E2E_BE_PORT ?? 3310)
const config = {
  ...createServerConfig(),
  port,
  authRequired: true,
  corsOrigin: '*',
  authTokens: [
    { token: 'pvp-e2e-alice-token', playerId: 'pvp-e2e-alice', playerName: 'E2E Alice', playerKind: 'human' as const },
    { token: 'pvp-e2e-bob-token', playerId: 'pvp-e2e-bob', playerName: 'E2E Bob', playerKind: 'human' as const },
  ],
}
const platform = new PvpPlatformService({
  store: new MemoryPvpStore(),
  runtimeTickRateMs: 20,
  timerIntervalMs: 10,
  countdownMs: 120,
  roundIntervalMs: 4_000,
  disconnectForfeitMs: 25_000,
  terminalRetentionMs: 1_000,
  maxRetainedTerminalMatches: 4,
})

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.get('/health', (_request, response) => response.json({ ok: true, service: 'pvp-e2e', realAuthority: true }))
app.get('/e2e/diagnostics', (_request, response) => response.json({ ok: true, diagnostics: platform.diagnostics() }))
app.post('/e2e/shutdown-runtime', (_request, response) => {
  platform.shutdown()
  response.json({ ok: true, diagnostics: platform.diagnostics() })
})
app.post('/e2e/matches/:matchId/skip-realtime-seq', (request, response) => {
  platform.injectRealtimeGapForE2e(request.params.matchId, 1)
  response.json({ ok: true, skipped: 1 })
})
app.use('/api/pvp', createPvpRestApiRouter(config, platform))
const server = http.createServer(app)

const shutdown = () => {
  platform.shutdown()
  console.log(JSON.stringify({ shutdownDiagnostics: platform.diagnostics() }))
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

void platform.ready
  .then(() => new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve)))
  .then(() => console.log(JSON.stringify({ ready: true, port, principals: config.authTokens.map(({ playerId }) => playerId) })))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
    shutdown()
  })
