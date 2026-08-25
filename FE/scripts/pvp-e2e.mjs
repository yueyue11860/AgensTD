import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const feRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(feRoot, '..')
const beRoot = path.join(repoRoot, 'BE')
const outputRoot = path.join(repoRoot, 'output', 'playwright')
const reportPath = path.join(outputRoot, 'pvp-e2e-report.json')
const bePort = Number(process.env.PVP_E2E_BE_PORT ?? 3310)
const fePort = Number(process.env.PVP_E2E_FE_PORT ?? 3311)
const apiBase = `http://127.0.0.1:${bePort}/api/pvp`
const feBase = `http://127.0.0.1:${fePort}`
const principals = {
  alice: { token: 'pvp-e2e-alice-token', playerId: 'pvp-e2e-alice' },
  bob: { token: 'pvp-e2e-bob-token', playerId: 'pvp-e2e-bob' },
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const processes = []
let immutableBuildDir = null
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  requestedRuns: 20,
  completedRuns: 0,
  blockers: [],
  networkScenarios: [],
  runs: [],
  summary: null,
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => process.stdout.write(`[${path.basename(cwd)}] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[${path.basename(cwd)}] ${chunk}`))
  processes.push(child)
  return child
}

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => process.stdout.write(`[${path.basename(cwd)}] ${chunk}`))
    child.stderr.on('data', (chunk) => process.stderr.write(`[${path.basename(cwd)}] ${chunk}`))
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)))
  })
}

async function hashBuildArtifact(root) {
  const files = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  await visit(root)
  files.sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(path.relative(root, file)); hash.update('\0'); hash.update(await readFile(file)); hash.update('\0')
  }
  return { algorithm: 'sha256', hash: hash.digest('hex'), fileCount: files.length }
}

async function waitHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return }
    catch { /* process is still starting */ }
    await delay(100)
  }
  throw new Error(`STARTUP_TIMEOUT:${url}`)
}

function queryFor(principal) {
  return new URLSearchParams({ token: principal.token, playerId: principal.playerId, apiBaseUrl: `http://127.0.0.1:${bePort}/api` }).toString()
}

async function browserFetch(page, principal, pathName, init = {}) {
  return page.evaluate(async ({ url, token, init }) => {
    const headers = new Headers(init.headers || {})
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body) headers.set('Content-Type', 'application/json')
    try {
      const response = await fetch(url, { ...init, headers })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      return { status: response.status, ok: response.ok, body }
    } catch (error) {
      return { status: 0, ok: false, body: { code: 'NETWORK_ERROR', message: String(error) } }
    }
  }, { url: `${apiBase}${pathName}`, token: principal.token, init })
}

async function requireOk(page, principal, pathName, init = {}) {
  const response = await browserFetch(page, principal, pathName, init)
  assert(response.ok, `${principal.playerId}:${pathName}:${response.status}:${JSON.stringify(response.body)}`)
  return response.body
}

async function waitForState(page, principal, matchId, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    const response = await browserFetch(page, principal, `/matches/${encodeURIComponent(matchId)}/state`)
    if (response.ok) {
      latest = response.body.state
      if (predicate(latest)) return latest
    }
    await delay(100)
  }
  throw new Error(`STATE_TIMEOUT:${label}:${JSON.stringify(latest?.phase ?? null)}`)
}

async function waitForServerState(principal, matchId, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBase}/matches/${encodeURIComponent(matchId)}/state`, {
      headers: { Authorization: `Bearer ${principal.token}` },
    })
    if (response.ok) {
      latest = (await response.json()).state
      if (predicate(latest)) return latest
    }
    await delay(100)
  }
  throw new Error(`STATE_TIMEOUT:${label}:${JSON.stringify(latest?.phase ?? null)}`)
}

function sideFor(state, playerId) {
  return state.sides.A?.playerId === playerId ? 'A' : 'B'
}

async function readOneSseFrame(page, principal, matchId) {
  return page.evaluate(async ({ url, token }) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: controller.signal })
      const reader = response.body.getReader()
      const { value } = await reader.read()
      await reader.cancel()
      return new TextDecoder().decode(value)
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  }, { url: `${apiBase}/matches/${encodeURIComponent(matchId)}/events`, token: principal.token })
}

async function auditPrivateRecruit(ownerPage, owner, opponentPage, opponent, matchId, unitId) {
  const opponentResponse = await requireOk(opponentPage, opponent, `/matches/${encodeURIComponent(matchId)}/state`)
  const ownerSide = sideFor(opponentResponse.state, owner.playerId)
  assert(opponentResponse.state.sides[ownerSide].privateState === null, `PRIVATE_STATE_RESPONSE_LEAK:${matchId}:${owner.playerId}`)
  assert(!JSON.stringify(opponentResponse).includes(unitId), `PRIVATE_UNIT_RESPONSE_LEAK:${matchId}:${unitId}`)
  assert(!(await opponentPage.locator('body').innerHTML()).includes(unitId), `PRIVATE_UNIT_DOM_LEAK:${matchId}:${unitId}`)
  const frame = await readOneSseFrame(opponentPage, opponent, matchId)
  assert(!frame.includes(unitId), `PRIVATE_UNIT_SSE_LEAK:${matchId}:${unitId}`)
  const ownerResponse = await requireOk(ownerPage, owner, `/matches/${encodeURIComponent(matchId)}/state`)
  const actualOwnerSide = sideFor(ownerResponse.state, owner.playerId)
  assert(JSON.stringify(ownerResponse.state.sides[actualOwnerSide].privateState).includes(unitId), `OWNER_PRIVATE_STATE_MISSING:${matchId}:${unitId}`)
}

async function recruit(page, principal, matchId, requestId, duplicate = false) {
  const before = (await requireOk(page, principal, `/matches/${encodeURIComponent(matchId)}/state`)).state
  const side = sideFor(before, principal.playerId)
  const own = before.sides[side]
  const input = { method: 'POST', body: JSON.stringify({ requestId, expectedTrayRevision: own.privateState.trayRevision }) }
  const first = await requireOk(page, principal, `/matches/${encodeURIComponent(matchId)}/recruit`, input)
  if (duplicate) {
    const second = await requireOk(page, principal, `/matches/${encodeURIComponent(matchId)}/recruit`, input)
    assert(second.duplicate === true, `DUPLICATE_RECEIPT_MISSING:${matchId}`)
    const afterDuplicate = (await requireOk(page, principal, `/matches/${encodeURIComponent(matchId)}/state`)).state
    assert(before.sides[side].rations - afterDuplicate.sides[side].rations === afterDuplicate.rulesSnapshot.recruitCost, `DUPLICATE_CHARGED_TWICE:${matchId}`)
  }
  const after = (await requireOk(page, principal, `/matches/${encodeURIComponent(matchId)}/state`)).state
  const privateState = after.sides[side].privateState
  const unit = [...privateState.tray, ...privateState.reserve].find((candidate) => candidate?.unitId === first.details.unitId)
  assert(unit, `RECRUIT_NOT_IN_OWNER_STORAGE:${matchId}`)
  return { state: after, side, unit, duplicate: Boolean(first.duplicate) }
}

async function deploy(page, principal, matchId, recruited) {
  const own = recruited.state.sides[recruited.side]
  const slot = recruited.state.rulesSnapshot.deploymentSlots[recruited.side]
    .find((candidate) => !own.boardPieces.some((piece) => piece.x === candidate.x && piece.y === candidate.y))
  assert(slot, `NO_DEPLOYMENT_SLOT:${matchId}:${principal.playerId}`)
  await requireOk(page, principal, `/matches/${encodeURIComponent(matchId)}/deploy`, {
    method: 'POST', body: JSON.stringify({
      requestId: `deploy:${matchId}:${principal.playerId}:${recruited.unit.unitId}`,
      unitId: recruited.unit.unitId, ...slot,
      expectedTrayRevision: own.privateState.trayRevision,
      expectedBoardRevision: own.privateState.boardRevision,
    }),
  })
}

async function recruitDeploy(page, principal, opponentPage, opponent, matchId, index, duplicate = false, audit = false) {
  const recruited = await recruit(page, principal, matchId, `recruit:${matchId}:${principal.playerId}:${index}`, duplicate)
  if (audit) await auditPrivateRecruit(page, principal, opponentPage, opponent, matchId, recruited.unit.unitId)
  await deploy(page, principal, matchId, recruited)
}

async function installScenario(pageA, pageB, scenario, counters) {
  const delayRoute = async (route, ms) => { await delay(ms); await route.continue() }
  if (scenario === 'rtt_120ms' || scenario === 'rtt_250ms') {
    const ms = scenario === 'rtt_120ms' ? 120 : 250
    await pageA.route('**/api/pvp/**', (route) => delayRoute(route, ms))
    await pageB.route('**/api/pvp/**', (route) => delayRoute(route, ms))
  }
  if (scenario === 'slow_load_ack') {
    await pageB.route('**/api/pvp/**/load-ack', (route) => delayRoute(route, 1_500))
  }
  if (scenario === 'sse_gap_rest_full') {
    pageA.on('request', (request) => {
      if (request.url().includes('/state') && request.headers()['x-pvp-recovery'] === 'gap') counters.restFullRequests += 1
    })
  }
  if (scenario === 'loss_1pct') {
    let requests = 0
    await pageA.route('**/api/pvp/**', async (route) => {
      requests += 1
      if (requests % 100 === 0) { counters.lossDrops += 1; await route.abort('connectionreset'); return }
      await route.continue()
    })
  }
}

async function clearScenario(page) {
  await page.unroute('**/api/pvp/**').catch(() => {})
}

async function runOne(index, pageA, pageB, contextA, contextB) {
  const started = Date.now()
  let terminalObservedAfterMs = null
  const scenario = index === 1 ? 'slow_load_ack'
    : index === 2 ? 'rtt_120ms'
      : index === 3 ? 'rtt_250ms'
        : index === 4 ? 'sse_gap_rest_full'
          : index === 5 ? 'background_tab'
            : index === 6 ? 'offline_10s_reconnect'
              : index === 7 ? 'loss_1pct'
                : index === 8 ? 'refresh_reconnect'
                  : index === 19 ? 'double_disconnect_draw'
                    : index === 0 ? 'duplicate_request' : 'normal'
  const counters = { sseCuts: 0, restFullRequests: 0, lossDrops: 0 }
  const aliceQuery = queryFor(principals.alice)
  const bobQuery = queryFor(principals.bob)
  await Promise.all([pageA.goto(`${feBase}/pvp?${aliceQuery}`), pageB.goto(`${feBase}/pvp?${bobQuery}`)])
  const created = await requireOk(pageA, principals.alice, '/rooms', { method: 'POST', body: JSON.stringify({ requestId: `room:${index}`, roomName: `E2E ${index + 1}`, password: '', spectatorsAllowed: false }) })
  const roomId = created.room.roomId
  await requireOk(pageB, principals.bob, `/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ requestId: `join:${index}`, password: '' }) })
  await requireOk(pageA, principals.alice, `/rooms/${roomId}/ready`, { method: 'POST', body: JSON.stringify({ requestId: `ready:a:${index}`, ready: true }) })
  const ready = await requireOk(pageB, principals.bob, `/rooms/${roomId}/ready`, { method: 'POST', body: JSON.stringify({ requestId: `ready:b:${index}`, ready: true }) })
  const matchId = ready.room.matchId
  assert(matchId, `MATCH_NOT_ACTIVATED:${index}`)
  await installScenario(pageA, pageB, scenario, counters)
  await Promise.all([
    pageA.goto(`${feBase}/pvp/game/${matchId}?${aliceQuery}`),
    pageB.goto(`${feBase}/pvp/game/${matchId}?${bobQuery}`),
  ])
  let playing = await waitForState(pageA, principals.alice, matchId, (state) => state.phase === 'playing', `playing:${index}`, 35_000)
  assert(playing.sides.A.loadStatus === 'loaded' && playing.sides.B.loadStatus === 'loaded', `BOTH_LOAD_ACK_REQUIRED:${matchId}`)

  if (scenario === 'background_tab') {
    const cover = await contextA.newPage()
    await cover.goto('about:blank')
    await cover.bringToFront()
    await delay(1_200)
    await pageA.bringToFront()
    await cover.close()
    await waitForState(pageA, principals.alice, matchId, (state) => state.sides.A.connected, `background-recover:${index}`)
  }
  if (scenario === 'sse_gap_rest_full') {
    // 先收到有序 SSE，再由非生产 E2E 控制面丢弃一个 envelope 序号；不改任何战斗状态。
    await delay(500)
    const injected = await fetch(`http://127.0.0.1:${bePort}/e2e/matches/${encodeURIComponent(matchId)}/skip-realtime-seq`, { method: 'POST' })
    assert(injected.ok, `SSE_GAP_INJECTION_FAILED:${matchId}`)
    counters.sseCuts += 1
    const recoveryDeadline = Date.now() + 5_000
    while (counters.restFullRequests < 1 && Date.now() < recoveryDeadline) await delay(50)
  }
  if (scenario === 'offline_10s_reconnect') {
    await contextA.setOffline(true)
    await delay(10_000)
    await contextA.setOffline(false)
    playing = await waitForState(pageA, principals.alice, matchId, (state) => state.phase === 'playing' && state.sides.A.connected, `offline-recover:${index}`)
  }
  if (scenario === 'refresh_reconnect') {
    await pageA.reload()
    await waitForState(pageA, principals.alice, matchId, (state) => state.phase === 'playing' && state.sides.A.connected, `refresh-recover:${index}`)
  }
  if (scenario === 'loss_1pct') {
    await pageA.evaluate(async ({ apiBase, token, matchId }) => {
      await Promise.allSettled(Array.from({ length: 100 }, () => fetch(`${apiBase}/matches/${matchId}/state`, { headers: { Authorization: `Bearer ${token}` } })))
    }, { apiBase, token: principals.alice.token, matchId })
    assert(counters.lossDrops >= 1, `LOSS_INJECTION_NOT_EXERCISED:${matchId}`)
  }

  await recruitDeploy(pageA, principals.alice, pageB, principals.bob, matchId, 0, index === 0, true)
  await recruitDeploy(pageB, principals.bob, pageA, principals.alice, matchId, 0, false, true)
  for (let unit = 1; unit < 3; unit += 1) {
    await recruitDeploy(pageA, principals.alice, pageB, principals.bob, matchId, unit)
    await recruitDeploy(pageB, principals.bob, pageA, principals.alice, matchId, unit)
  }
  const combat = await waitForState(pageA, principals.alice, matchId, (state) => state.sides.A.stats.baseKills >= 5 && state.sides.B.stats.baseKills >= 1, `authoritative-kill:${index}`, 30_000)
  assert(combat.recentEvents.some((event) => event.type === 'ENEMY_KILLED' || event.type === 'PIECE_ATTACKED'), `NO_AUTHORITATIVE_COMBAT_EVENT:${matchId}`)
  const pressure = await requireOk(pageA, principals.alice, `/matches/${matchId}/pressure`, { method: 'POST', body: JSON.stringify({ requestId: `pressure:${matchId}` }) })
  assert(pressure.code === 'PRESSURE_QUEUED', `PRESSURE_NOT_QUEUED:${matchId}`)

  if (scenario === 'double_disconnect_draw') {
    // 关闭真实 page 确保两条 SSE socket 被浏览器回收；导航/offline 可能在 OS 层保留 TCP 半开连接。
    await Promise.all([pageA.close(), pageB.close()])
    // 宿主 timer 在长跑中可有漂移；等服务端权威终局，不用固定 wall sleep 猜测模拟 tick。
    const disconnectedAt = Date.now()
    await waitForServerState(principals.alice, matchId, (state) => state.phase === 'completed' || state.phase === 'voided', 'double-disconnect-authority', 30_000)
    terminalObservedAfterMs = Date.now() - disconnectedAt
    pageA = await contextA.newPage()
    pageB = await contextB.newPage()
    await Promise.all([
      pageA.goto(`${feBase}/pvp/game/${matchId}?${aliceQuery}`),
      pageB.goto(`${feBase}/pvp/game/${matchId}?${bobQuery}`),
    ])
  } else {
    await requireOk(pageB, principals.bob, `/matches/${matchId}/surrender`, { method: 'POST', body: JSON.stringify({ requestId: `surrender:${matchId}` }) })
  }
  const terminal = await waitForState(pageA, principals.alice, matchId, (state) => state.phase === 'completed' || state.phase === 'voided', `terminal:${index}`, 30_000)
  if (scenario === 'double_disconnect_draw') assert(terminal.result?.reason === 'simultaneous_draw', `DOUBLE_DISCONNECT_NOT_DRAW:${matchId}:${terminal.result?.reason}`)
  else assert(terminal.result?.reason === 'surrendered', `SURRENDER_RESULT_MISMATCH:${matchId}:${terminal.result?.reason}`)
  const detail = await requireOk(pageA, principals.alice, `/matches/${matchId}`)
  const repeatedDetail = await requireOk(pageA, principals.alice, `/matches/${matchId}`)
  const settlementIds = detail.detail.settlements.map((item) => item.settlementId)
  assert(settlementIds.length === 2 && new Set(settlementIds).size === 2, `SETTLEMENT_ID_DUPLICATE:${matchId}`)
  assert(JSON.stringify(settlementIds) === JSON.stringify(repeatedDetail.detail.settlements.map((item) => item.settlementId)), `SETTLEMENT_REFRESH_NOT_IDEMPOTENT:${matchId}`)
  if (scenario === 'sse_gap_rest_full') assert(counters.sseCuts >= 1 && counters.restFullRequests >= 1 && counters.restFullRequests <= 3, `SSE_GAP_REST_FULL_OUT_OF_BUDGET:${matchId}:${JSON.stringify(counters)}`)
  await Promise.all([pageA.goto('about:blank'), pageB.goto('about:blank')])
  await Promise.all([clearScenario(pageA), clearScenario(pageB)])
  return {
    index: index + 1,
    scenario,
    matchId,
    durationMs: Date.now() - started,
    finalStateHash: terminal.result.finalStateHash,
    resultReason: terminal.result.reason,
    settlementRequestId: detail.detail.match.settlementRequestId,
    settlementIds,
    rewards: detail.detail.settlements.map((item) => ({ playerId: item.playerId, rewardStatus: item.rewardStatus, reward: item.reward })),
    counters,
    baseKills: { A: terminal.sides.A.stats.baseKills, B: terminal.sides.B.stats.baseKills },
    pressureSent: terminal.sides.A.stats.pressureSent + terminal.sides.B.stats.pressureSent,
    terminalObservedAfterMs,
  }
}

async function main() {
  await mkdir(outputRoot, { recursive: true })
  try {
    await readFile(path.join(outputRoot, 'pvp-e2e-report-failed-first.json'), 'utf8')
  } catch {
    try {
      const previous = JSON.parse(await readFile(reportPath, 'utf8'))
      if (previous?.summary?.passed === false) await copyFile(reportPath, path.join(outputRoot, 'pvp-e2e-report-failed-first.json'))
    } catch { /* first run has no previous report */ }
  }
  await Promise.all(['pvp-e2e-failure-alice.png', 'pvp-e2e-failure-bob.png', 'pvp-e2e-failure-alice.zip', 'pvp-e2e-failure-bob.zip']
    .map((file) => rm(path.join(outputRoot, file), { force: true })))
  const feEnv = { VITE_AUTH_BYPASS: 'true', VITE_API_BASE_URL: `http://127.0.0.1:${bePort}/api` }
  immutableBuildDir = await mkdtemp(path.join(outputRoot, '.pvp-e2e-build-'))
  await run('pnpm', ['exec', 'vite', 'build', '--config', 'scripts/vite.pvp-e2e.config.mjs', '--outDir', immutableBuildDir], feRoot, feEnv)
  report.artifact = await hashBuildArtifact(immutableBuildDir)
  start('pnpm', ['exec', 'ts-node', 'src/pvp-platform-v1/e2e-server.ts'], beRoot, { NODE_ENV: 'test', PVP_E2E_ENABLED: 'true', PVP_E2E_BE_PORT: String(bePort) })
  start('pnpm', ['exec', 'vite', 'preview', '--config', 'scripts/vite.pvp-e2e.config.mjs', '--outDir', immutableBuildDir, '--host', '127.0.0.1', '--port', String(fePort)], feRoot, feEnv)
  await Promise.all([waitHttp(`http://127.0.0.1:${bePort}/health`), waitHttp(feBase)])
  const browser = await chromium.launch({ headless: true })
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await Promise.all([contextA.tracing.start({ screenshots: true, snapshots: true }), contextB.tracing.start({ screenshots: true, snapshots: true })])
  try {
    for (let index = 0; index < report.requestedRuns; index += 1) {
      const run = await runOne(index, pageA, pageB, contextA, contextB)
      report.runs.push(run)
      report.completedRuns += 1
      if (run.scenario !== 'normal' && run.scenario !== 'duplicate_request' && run.scenario !== 'refresh_reconnect' && run.scenario !== 'double_disconnect_draw') report.networkScenarios.push(run.scenario)
      process.stdout.write(`${JSON.stringify({ pvpE2eRun: run.index, scenario: run.scenario, matchId: run.matchId, durationMs: run.durationMs })}\n`)
    }
    const allSettlementIds = report.runs.flatMap((run) => run.settlementIds)
    const allRequestIds = report.runs.map((run) => run.settlementRequestId)
    assert(new Set(allSettlementIds).size === allSettlementIds.length, 'CROSS_MATCH_SETTLEMENT_ID_DUPLICATE')
    assert(new Set(allRequestIds).size === allRequestIds.length, 'CROSS_MATCH_SETTLEMENT_REQUEST_DUPLICATE')
    await Promise.all([
      pageA.isClosed() ? Promise.resolve() : pageA.goto('about:blank'),
      pageB.isClosed() ? Promise.resolve() : pageB.goto('about:blank'),
    ])
    let diagnostics = null
    for (let attempt = 0; attempt < 60; attempt += 1) {
      diagnostics = (await (await fetch(`http://127.0.0.1:${bePort}/e2e/diagnostics`)).json()).diagnostics
      if (diagnostics.liveMatches === 0 && diagnostics.customRooms === 0 && diagnostics.activeMatches === 0
        && diagnostics.subscriberCount === 0 && diagnostics.realtimeConnections === 0) break
      await delay(100)
    }
    assert(diagnostics?.tickTimerActive === 1, `PVP_TICK_TIMER_GROWTH:${JSON.stringify(diagnostics)}`)
    assert(diagnostics?.liveMatches === 0 && diagnostics?.customRooms === 0 && diagnostics?.retainedTerminalMatches === 0
      && diagnostics?.activeMatches === 0 && diagnostics?.subscriberCount === 0 && diagnostics?.realtimeConnections === 0,
    `PVP_TERMINAL_RESOURCE_LEAK:${JSON.stringify(diagnostics)}`)
    const shutdownDiagnostics = (await (await fetch(`http://127.0.0.1:${bePort}/e2e/shutdown-runtime`, { method: 'POST' })).json()).diagnostics
    assert(shutdownDiagnostics.tickTimerActive === 0, `PVP_SHUTDOWN_TIMER_LEAK:${JSON.stringify(shutdownDiagnostics)}`)
    report.summary = {
      passed: true,
      blockerRate: 0,
      completedRuns: report.completedRuns,
      disturbedRuns: report.networkScenarios.length,
      averageDurationMs: Math.round(report.runs.reduce((sum, run) => sum + run.durationMs, 0) / report.runs.length),
      p95DurationMs: [...report.runs].sort((a, b) => a.durationMs - b.durationMs)[Math.floor(report.runs.length * .95) - 1]?.durationMs ?? 0,
      uniqueFinalStateHashes: new Set(report.runs.map((run) => run.finalStateHash)).size,
      uniqueSettlementIds: new Set(allSettlementIds).size,
      terminalDiagnostics: shutdownDiagnostics,
    }
    await Promise.all([contextA.tracing.stop(), contextB.tracing.stop()])
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    report.blockers.push({ run: report.completedRuns + 1, message })
    report.summary = { passed: false, blockerRate: 1 / report.requestedRuns, completedRuns: report.completedRuns, firstBlocker: message }
    await Promise.all([
      pageA.screenshot({ path: path.join(outputRoot, 'pvp-e2e-failure-alice.png'), fullPage: true }).catch(() => null),
      pageB.screenshot({ path: path.join(outputRoot, 'pvp-e2e-failure-bob.png'), fullPage: true }).catch(() => null),
      contextA.tracing.stop({ path: path.join(outputRoot, 'pvp-e2e-failure-alice.zip') }).catch(() => null),
      contextB.tracing.stop({ path: path.join(outputRoot, 'pvp-e2e-failure-bob.zip') }).catch(() => null),
    ])
    throw error
  } finally {
    report.finishedAt = new Date().toISOString()
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    await browser.close()
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    for (const child of processes) child.kill('SIGTERM')
    await delay(250)
    if (immutableBuildDir) await rm(immutableBuildDir, { recursive: true, force: true })
  })
