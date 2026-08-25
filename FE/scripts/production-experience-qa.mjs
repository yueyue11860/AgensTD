import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const feRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(feRoot, '..')
const beRoot = path.join(repoRoot, 'BE')
const outputRoot = path.join(repoRoot, 'output', 'playwright')
const reportPath = path.join(outputRoot, 'production-experience-qa.json')
const bePort = 3320; const fePort = 3321
const query = new URLSearchParams({ token: 'human-dev-token', gatewayToken: 'human-dev-token', apiBaseUrl: `http://127.0.0.1:${bePort}/api`, wsUrl: `http://127.0.0.1:${bePort}` }).toString()
const viewports = [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]
const processes = []; let buildDir = null
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function start(command, args, cwd, env = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => process.stdout.write(`[${path.basename(cwd)}] ${chunk}`)); child.stderr.on('data', chunk => process.stderr.write(`[${path.basename(cwd)}] ${chunk}`))
  processes.push(child); return child
}
function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => process.stdout.write(`[${path.basename(cwd)}] ${chunk}`)); child.stderr.on('data', chunk => process.stderr.write(`[${path.basename(cwd)}] ${chunk}`))
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
  })
}
async function waitHttp(url, timeout = 30_000) { const end = Date.now() + timeout; while (Date.now() < end) { try { if ((await fetch(url)).ok) return } catch {} await delay(100) } throw new Error(`STARTUP_TIMEOUT:${url}`) }
async function artifactHash(root) {
  const files = []; const visit = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const absolute = path.join(dir, entry.name); if (entry.isDirectory()) await visit(absolute); else if (entry.isFile()) files.push(absolute) } }
  await visit(root); files.sort(); const hash = createHash('sha256'); for (const file of files) { hash.update(path.relative(root, file)); hash.update('\0'); hash.update(await readFile(file)); hash.update('\0') } return { sha256: hash.digest('hex'), fileCount: files.length }
}
async function pageMetrics(page, networkEvents, label) {
  const cdp = await page.context().newCDPSession(page); const heap = await cdp.send('Runtime.getHeapUsage')
  const metrics = await page.evaluate(async () => {
    const surface = document.querySelector('.gaming-phaser-surface')
    const frames = []; let last = performance.now(); const end = last + 3000
    await new Promise(resolve => { const step = now => { frames.push(now - last); last = now; if (now < end) requestAnimationFrame(step); else resolve() }; requestAnimationFrame(step) })
    const longTasks = performance.getEntriesByType('longtask')
    return {
      fps: Math.round(1000 / (frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length)) * 10) / 10,
      frameP95Ms: frames.sort((a, b) => a - b)[Math.floor(frames.length * .95)] ?? 0,
      longTaskCount: longTasks.length,
      longTaskDurationMs: Math.round(longTasks.reduce((sum, item) => sum + item.duration, 0)),
      domNodes: document.getElementsByTagName('*').length,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      vfx: surface ? {
        active: Number(surface.dataset.activeVfxObjects || 0), pooled: Number(surface.dataset.pooledVfxObjects || 0),
        display: Number(surface.dataset.displayObjects || 0), enemies: Number(surface.dataset.enemyViews || 0), seenEnemies: Number(surface.dataset.seenEnemyCount || 0),
      } : null,
    }
  })
  await cdp.detach()
  return { label, ...metrics, jsHeapUsedBytes: heap.usedSize, networkEvents }
}

async function authoritativeSnapshot(page) {
  return page.locator('.gaming-page').evaluate((node) => ({
    tick: Number(node.dataset.authoritativeTick || 0),
    wave: Number(node.dataset.wave || 0),
    enemies: Number(node.dataset.enemyCount || 0),
    overloadTicks: Number(node.dataset.overloadTicks || 0),
    overloadCountdownSec: Number(node.dataset.overloadCountdownSec || 0),
    enemyCapacity: Number(node.dataset.enemyCapacity || 0),
    rice: Number(node.dataset.rice || 0),
    nextRecruitCost: Number(node.dataset.nextRecruitCost || 0),
    boardPieces: Number(node.dataset.boardPieceCount || 0),
    trayPieces: Number(node.dataset.trayPieceCount || 0),
    outcome: node.dataset.matchOutcome || null,
  }))
}

const safeCells = [
  // 与权威 full-build simulator 相同的 P1 路径邻接位；合法且有实际射程覆盖。
  { x: 14, y: 18 }, { x: 10, y: 17 }, { x: 6, y: 18 }, { x: 6, y: 20 },
  { x: 10, y: 20 }, { x: 15, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 17 },
  { x: 20, y: 13 }, { x: 20, y: 9 }, { x: 17, y: 8 }, { x: 12, y: 8 },
  { x: 8, y: 8 }, { x: 6, y: 10 },
]
async function firstUiDeploy(page, surface, roomId) {
  const recruit = page.locator('.gaming-recruit-button:not(:disabled)')
  await recruit.waitFor({ state: 'visible', timeout: 20_000 })
  await recruit.click({ timeout: 2_000 })
  await page.waitForFunction(() => Number(document.querySelector('.gaming-page')?.dataset.trayPieceCount || 0) > 0, null, { timeout: 5_000 })
  const stateResponse = await e2eApi(page, `/api/e2e/rooms/${encodeURIComponent(roomId)}/state`)
  const player = stateResponse.payload?.state?.pve?.players?.find(candidate => candidate.playerId === 'human-dev')
  const soldier = player?.tray?.find(entry => entry.piece?.kind === 'soldier')
  assert(soldier, 'FIRST_UI_RECRUIT_HAS_NO_SOLDIER')
  await page.locator('.gaming-summon-tray .gaming-tray-slot').nth(soldier.index).click({ timeout: 2_000 })
  await page.mouse.move(2, 2)
  await surface.focus()
  await delay(100)
  await page.keyboard.press('ArrowDown'); await delay(100); await page.keyboard.press('ArrowDown'); await delay(100)
  await page.keyboard.press('ArrowDown'); await delay(100); await page.keyboard.press('ArrowDown'); await delay(100)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => Number(document.querySelector('.gaming-page')?.dataset.boardPieceCount || 0) >= 1, null, { timeout: 5_000 })
  return 1
}

async function e2eApi(page, pathname, method = 'GET', body) {
  const url = `http://127.0.0.1:${bePort}${pathname}`
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, {
      method,
      headers: { authorization: 'Bearer human-dev-token', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, payload: await response.json() }
  }, { url, method, body })
}

async function setHostLoop(page, roomId, intervalMs) {
  const result = await e2eApi(page, '/api/e2e/host-loop', 'POST', { roomId, intervalMs })
  assert(result.status === 200 && result.payload.ok, `HOST_LOOP_CONTROL_FAILED:${JSON.stringify(result)}`)
  return result.payload
}

async function restAutoBuild(page, roomId, requestSequence) {
  const response = await e2eApi(page, `/api/e2e/rooms/${encodeURIComponent(roomId)}/state`)
  if (response.status !== 200 || !response.payload.ok) return { requestSequence, accepted: false }
  const state = response.payload.state
  const pve = state?.pve; const player = pve?.players?.find(candidate => candidate.playerId === 'human-dev')
  if (!pve || !player || state.status !== 'running') return { requestSequence, accepted: false }
  const tray = player.tray ?? []; const board = pve.boardPieces?.filter(piece => piece.ownerPlayerId === 'human-dev') ?? []
  const occupied = new Set(board.map(piece => `${piece.x}:${piece.y}`))
  const trayEntry = tray.find(entry => entry.piece?.kind === 'soldier')
  let payload = null
  if (trayEntry?.piece && player.populationUsed < player.populationCap) {
    const cell = safeCells.find(candidate => !occupied.has(`${candidate.x}:${candidate.y}`))
    if (cell) payload = { action: 'DEPLOY_TRAY_PIECE', trayIndex: trayEntry.index, ...cell, expectedTrayRevision: player.trayRevision, expectedBoardRevision: player.boardRevision }
  }
  if (!payload && trayEntry?.piece?.kind === 'soldier') {
    const target = board.find(piece => piece.kind === 'soldier' && piece.soldierType === trayEntry.piece.soldierType && piece.level === trayEntry.piece.level && piece.level < 5)
    if (target) payload = { action: 'MERGE_SOLDIERS', sourceEntityId: trayEntry.piece.entityId, targetEntityId: target.entityId, expectedTrayRevision: player.trayRevision, expectedBoardRevision: player.boardRevision }
  }
  if (!payload && player.rice >= player.nextRecruitCost) payload = { action: 'RECRUIT_BATCH', expectedTrayRevision: player.trayRevision }
  if (!payload) return { requestSequence, accepted: false }
  const nextSequence = requestSequence + 1
  const action = await e2eApi(page, `/api/e2e/rooms/${encodeURIComponent(roomId)}/actions`, 'POST', {
    requestId: `experience-auto-build-${nextSequence}`,
    clientTick: state.tick,
    payload,
  })
  return { requestSequence: nextSequence, accepted: action.status === 202 && action.payload.ok }
}

async function main() {
  await mkdir(outputRoot, { recursive: true }); buildDir = await mkdtemp(path.join(outputRoot, '.experience-qa-build-'))
  const feEnv = { VITE_AUTH_BYPASS: 'true', VITE_API_BASE_URL: `http://127.0.0.1:${bePort}/api`, VITE_WS_URL: `http://127.0.0.1:${bePort}`, VITE_GATEWAY_TOKEN: 'human-dev-token', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
  await run('pnpm', ['exec', 'vite', 'build', '--config', 'scripts/vite.pvp-e2e.config.mjs', '--outDir', buildDir], feRoot, feEnv)
  const artifact = await artifactHash(buildDir)
  start('pnpm', ['exec', 'ts-node', 'src/server.ts'], beRoot, { NODE_ENV: 'test', PORT: String(bePort), TICK_RATE_MS: '100', PVE_E2E_ENABLED: 'true', HOST_LOOP_INTERVAL_MS: '100', BROADCAST_INTERVAL_MS: '200', FULL_SNAPSHOT_INTERVAL_MS: '1000', HUMAN_GATEWAY_TOKEN: 'human-dev-token', AUTH_REQUIRED: 'true', PVE_SETTLEMENT_RECOVERY_ENABLED: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })
  start('pnpm', ['exec', 'vite', 'preview', '--config', 'scripts/vite.pvp-e2e.config.mjs', '--outDir', buildDir, '--host', '127.0.0.1', '--port', String(fePort)], feRoot, feEnv)
  await Promise.all([waitHttp(`http://127.0.0.1:${bePort}/health`), waitHttp(`http://127.0.0.1:${fePort}`)])
  const browser = await chromium.launch({ headless: true }); const report = { artifact, browser: 'Chromium', unavailable: ['WebKit browser binary', 'physical touch device'], viewports: [], mainChain: {}, performance: [], thresholds: {}, consoleErrors: [], expectedOfflineConsoleErrors: [] }
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width <= 430, isMobile: viewport.width <= 430 })
      const page = await context.newPage(); const errors = []; page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`http://127.0.0.1:${fePort}/?${query}`); await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
      assert(!overflow, `HOME_OVERFLOW:${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: path.join(outputRoot, `qa-home-${viewport.width}x${viewport.height}.png`), fullPage: true })
      report.viewports.push({ ...viewport, homeOverflow: overflow, consoleErrors: errors.length }); report.consoleErrors.push(...errors)
      await context.close()
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true }); const page = await context.newPage()
    const networkCdp = await context.newCDPSession(page); await networkCdp.send('Network.enable')
    const realtime = { websocketFrames: 0, websocketBytes: 0, combatBatchFrames: 0 }
    networkCdp.on('Network.webSocketFrameReceived', ({ response }) => { realtime.websocketFrames += 1; realtime.websocketBytes += response.payloadData.length; if (response.payloadData.includes('COMBAT_EVENT_BATCH')) realtime.combatBatchFrames += 1 })
    let networkEvents = 0; page.on('request', () => { networkEvents += 1 }); page.on('console', message => {
      if (message.type() !== 'error') return
      if (message.text().includes('ERR_INTERNET_DISCONNECTED')) report.expectedOfflineConsoleErrors.push(message.text())
      else report.consoleErrors.push(message.text())
    })
    await page.addInitScript(() => { window.__qaLongTaskObserver = new PerformanceObserver(() => {}); try { window.__qaLongTaskObserver.observe({ type: 'longtask', buffered: true }) } catch {} })
    await page.goto(`http://127.0.0.1:${fePort}/?${query}`); await page.goto(`http://127.0.0.1:${fePort}/room?${query}`)
    await page.getByRole('button', { name: /立下战旗/ }).click(); await page.locator('.term-input').first().fill('最终体验验收队'); await page.getByRole('button', { name: '建立队伍' }).click()
    await page.waitForURL(url => url.pathname.startsWith('/room/'), { timeout: 15_000 })
    await page.screenshot({ path: path.join(outputRoot, 'qa-room-before-start.png'), fullPage: true })
    await page.getByRole('button', { name: /下达守关军令/ }).click({ timeout: 15_000 })
    await page.waitForURL(/\/gaming/, { timeout: 20_000 }); await page.screenshot({ path: path.join(outputRoot, 'qa-gaming-before-stage.png'), fullPage: true })
    const difficulty = page.locator('.mission-difficulty-button:not(:disabled)').first()
    await difficulty.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null)
    if (await difficulty.isVisible().catch(() => false)) await difficulty.click({ timeout: 15_000 })
    const surface = page.locator('.gaming-phaser-surface')
    const roomId = new URL(page.url()).searchParams.get('roomId')
    assert(roomId, 'MISSING_ACTIVE_ROOM_ID')
    const initialUiBuildActions = await firstUiDeploy(page, surface, roomId)
    let requestSequence = 0; let initialRestBuildActions = 0; let initialFormation = await authoritativeSnapshot(page); let initialSoldiers = 1
    const formationDeadline = Date.now() + 20_000
    while (initialSoldiers < 5 && Date.now() < formationDeadline) {
      const build = await restAutoBuild(page, roomId, requestSequence)
      requestSequence = build.requestSequence
      if (build.accepted) initialRestBuildActions += 1
      await delay(400)
      initialFormation = await authoritativeSnapshot(page)
      const formationState = await e2eApi(page, `/api/e2e/rooms/${encodeURIComponent(roomId)}/state`)
      const formationPlayer = formationState.payload?.state?.pve?.players?.find(candidate => candidate.playerId === 'human-dev')
      initialSoldiers = Number(formationPlayer?.populationUsed ?? 0)
    }
    assert(initialSoldiers >= 5, `INITIAL_FORMATION_NOT_READY:${JSON.stringify({ ...initialFormation, initialSoldiers })}`)
    await surface.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter')
    await page.keyboard.press('+'); await page.keyboard.press('-'); report.mainChain.deployed = initialSoldiers >= 5
    await page.screenshot({ path: path.join(outputRoot, 'qa-main-chain-deployed-1280x720.png'), fullPage: true })
    report.performance.push(await pageMetrics(page, networkEvents, 'post-deploy'))
    const offlineStarted = Date.now(); await context.setOffline(true); await delay(2_000); await context.setOffline(false); await page.getByRole('button', { name: /重连|重新连接/ }).click({ timeout: 3_000 }).catch(() => null)
    await page.waitForFunction(() => !document.body.innerText.includes('连接中断') || document.body.innerText.includes('已恢复'), null, { timeout: 20_000 }).catch(() => null)
    report.mainChain.offlineRecoveryMs = Date.now() - offlineStarted
    await page.emulateMedia({ reducedMotion: 'reduce' }); report.mainChain.reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)

    const initialAuthority = await authoritativeSnapshot(page)
    const accelerationControl = await setHostLoop(page, roomId, 20)
    const stressStart = Date.now(); let lastAuthority = initialAuthority; let acceptedBuildActions = initialUiBuildActions + initialRestBuildActions
    let peak = { seenEnemies: 0, activeEnemies: 0, activeVfx: 0, pooledVfx: 0, display: 0, dom: 0, heap: 0 }
    const authorityTimeline = []
    while (Date.now() - stressStart < 150_000 && !await page.locator('.game-over-panel').count()) {
      const build = await restAutoBuild(page, roomId, requestSequence); requestSequence = build.requestSequence; if (build.accepted) acceptedBuildActions += 1
      await delay(350); const sample = await page.evaluate(() => { const s = document.querySelector('.gaming-phaser-surface'); return { seenEnemies: Number(s?.dataset.seenEnemyCount || 0), activeVfx: Number(s?.dataset.activeVfxObjects || 0), pooledVfx: Number(s?.dataset.pooledVfxObjects || 0), display: Number(s?.dataset.displayObjects || 0), dom: document.getElementsByTagName('*').length } })
      lastAuthority = await authoritativeSnapshot(page); sample.activeEnemies = lastAuthority.enemies
      if (authorityTimeline.length === 0 || lastAuthority.wave !== authorityTimeline.at(-1).wave) authorityTimeline.push({ wallMs: Date.now() - stressStart, ...lastAuthority })
      const cdp = await context.newCDPSession(page); const heap = await cdp.send('Runtime.getHeapUsage'); await cdp.detach(); sample.heap = heap.usedSize
      for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], sample[key] || 0)
    }
    report.mainChain.stressWallMs = Date.now() - stressStart
    report.mainChain.logicalTickDelta = Math.max(0, lastAuthority.tick - initialAuthority.tick)
    report.mainChain.logicalDurationMs = report.mainChain.logicalTickDelta * 100
    report.mainChain.accelerationRatio = report.mainChain.logicalDurationMs / Math.max(1, report.mainChain.stressWallMs)
    report.mainChain.accelerationControl = accelerationControl; report.mainChain.initialUiBuildActions = initialUiBuildActions; report.mainChain.initialRestBuildActions = initialRestBuildActions
    report.mainChain.initialAuthority = initialAuthority; report.mainChain.finalAuthority = lastAuthority; report.mainChain.authorityTimeline = authorityTimeline
    report.mainChain.acceptedBuildActions = acceptedBuildActions; report.mainChain.peak = peak; report.mainChain.realtime = realtime
    report.performance.push(await pageMetrics(page, networkEvents, 'stress-end'))
    for (const viewport of viewports) { await page.setViewportSize(viewport); await delay(250); const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert(!overflow, `GAME_OVERFLOW:${viewport.width}x${viewport.height}`); await page.screenshot({ path: path.join(outputRoot, `qa-game-${viewport.width}x${viewport.height}.png`), fullPage: true }); report.viewports.find(item => item.width === viewport.width).gameOverflow = overflow }
    await page.locator('.game-over-panel').waitFor({ state: 'visible', timeout: 45_000 }).catch(() => null)
    report.mainChain.settlementVisible = await page.locator('.game-over-panel').count() > 0
    report.thresholds = { minHeadlessSoftwareFps: 20, maxHeadlessFrameP95Ms: 55, maxLongTasks: 25, maxDomNodes: 2500, maxActiveVfx: 32, maxPooledVfx: 66, maxHeapGrowthBytes: 64 * 1024 * 1024, minActiveEnemies: 80, minCombatEvents: 300, minLogicalDurationMs: 300_000 }
    const first = report.performance[0], last = report.performance.at(-1); report.verdicts = {
      fps: last.fps >= 20, frameP95: last.frameP95Ms <= 55, longTasks: last.longTaskCount <= 25, dom: peak.dom <= 2500,
      vfx: peak.activeVfx <= 32 && peak.pooledVfx <= 66, heap: last.jsHeapUsedBytes - first.jsHeapUsedBytes <= 64 * 1024 * 1024,
      deployed: report.mainChain.deployed, settlement: report.mainChain.settlementVisible,
    }
    await networkCdp.detach()
    await context.close()

    const stressContext = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const stressPage = await stressContext.newPage()
    const stressCdp = await stressContext.newCDPSession(stressPage); await stressCdp.send('Network.enable')
    const stressRealtime = { websocketFrames: 0, websocketBytes: 0, combatBatchFrames: 0 }
    stressCdp.on('Network.webSocketFrameReceived', ({ response }) => { stressRealtime.websocketFrames += 1; stressRealtime.websocketBytes += response.payloadData.length; if (response.payloadData.includes('COMBAT_EVENT_BATCH')) stressRealtime.combatBatchFrames += 1 })
    let stressNetworkEvents = 0; stressPage.on('request', () => { stressNetworkEvents += 1 }); stressPage.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(`[stress] ${message.text()}`) })
    await stressPage.goto(`http://127.0.0.1:${fePort}/?${query}`)
    const stressTicket = await e2eApi(stressPage, '/api/e2e/renderer-stress')
    assert(stressTicket.status === 200 && stressTicket.payload.ok && stressTicket.payload.writesAccount === false && stressTicket.payload.createsSettlement === false, `STRESS_FIXTURE_GATE_FAILED:${JSON.stringify(stressTicket)}`)
    await stressPage.goto(`http://127.0.0.1:${fePort}/gaming?roomId=E2E-RENDERER-STRESS&${query}`)
    const stressSurface = stressPage.locator('.gaming-phaser-surface')
    await stressPage.waitForFunction(() => Number(document.querySelector('.gaming-phaser-surface')?.dataset.enemyViews || 0) >= 80, null, { timeout: 20_000 })
    const stressStartAuthority = await authoritativeSnapshot(stressPage); const stressFirst = await pageMetrics(stressPage, stressNetworkEvents, 'renderer-stress-start')
    const rendererStart = Date.now(); let stressPeak = { activeEnemies: 0, seenEnemies: 0, activeVfx: 0, pooledVfx: 0, display: 0, dom: 0, heap: 0 }
    while (Date.now() - rendererStart < 60_000) {
      await delay(1_000)
      const sample = await stressPage.evaluate(() => { const s = document.querySelector('.gaming-phaser-surface'); return { activeEnemies: Number(s?.dataset.enemyViews || 0), seenEnemies: Number(s?.dataset.seenEnemyCount || 0), activeVfx: Number(s?.dataset.activeVfxObjects || 0), pooledVfx: Number(s?.dataset.pooledVfxObjects || 0), display: Number(s?.dataset.displayObjects || 0), dom: document.getElementsByTagName('*').length } })
      const heap = await stressCdp.send('Runtime.getHeapUsage'); sample.heap = heap.usedSize
      for (const key of Object.keys(stressPeak)) stressPeak[key] = Math.max(stressPeak[key], sample[key] || 0)
    }
    const stressEndAuthority = await authoritativeSnapshot(stressPage); const stressLast = await pageMetrics(stressPage, stressNetworkEvents, 'renderer-stress-end')
    await stressPage.screenshot({ path: path.join(outputRoot, 'qa-renderer-stress-1280x720.png'), fullPage: true })
    await stressPage.setViewportSize({ width: 390, height: 844 }); await delay(300)
    const stressMobileOverflow = await stressPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    await stressPage.screenshot({ path: path.join(outputRoot, 'qa-renderer-stress-390x844.png'), fullPage: true })
    report.rendererProtocolStress = {
      fixtureKind: 'renderer/protocol fixture; not a real match, damage, reward, account write, or settlement',
      productionForbidden: true, ticket: stressTicket.payload, wallMs: Date.now() - rendererStart,
      logicalTickDelta: stressEndAuthority.tick - stressStartAuthority.tick,
      logicalDurationMs: (stressEndAuthority.tick - stressStartAuthority.tick) * 100,
      startAuthority: stressStartAuthority, endAuthority: stressEndAuthority, peak: stressPeak,
      realtime: stressRealtime, first: stressFirst, last: stressLast, mobileOverflow: stressMobileOverflow,
    }
    report.stressVerdicts = {
      duration: report.rendererProtocolStress.logicalDurationMs >= 300_000,
      activeEnemies: stressPeak.activeEnemies >= 80,
      combatEvents: stressRealtime.combatBatchFrames >= 300,
      fps: stressLast.fps >= 20, frameP95: stressLast.frameP95Ms <= 55,
      longTasks: stressLast.longTaskCount <= 25, dom: stressPeak.dom <= 2500,
      vfx: stressPeak.activeVfx <= 32 && stressPeak.pooledVfx <= 66,
      heap: stressLast.jsHeapUsedBytes - stressFirst.jsHeapUsedBytes <= 64 * 1024 * 1024,
      mobileOverflow: !stressMobileOverflow,
    }
    await stressCdp.detach(); await stressContext.close()
    assert(Object.values(report.verdicts).every(Boolean), `JOURNEY_THRESHOLD_FAILURE:${JSON.stringify(report.verdicts)}`)
    assert(Object.values(report.stressVerdicts).every(Boolean), `STRESS_THRESHOLD_FAILURE:${JSON.stringify(report.stressVerdicts)}`)
  } finally { await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { for (const child of processes) child.kill('SIGTERM'); await delay(250); if (buildDir) await rm(buildDir, { recursive: true, force: true }) })
