import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api'
const AGENT_API_BASE_URL = `${API_BASE_URL}/agent`
const HUMAN_TOKEN = process.env.HUMAN_GATEWAY_TOKEN ?? 'human-dev-token'
const AGENT_TOKEN = process.env.AGENT_GATEWAY_TOKEN ?? 'agent-dev-token'
const RUN_DURATION_MS = Number(process.env.RUN_DURATION_MS ?? 10 * 60 * 1000)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000)
const SAMPLE_INTERVAL_MS = Number(process.env.SAMPLE_INTERVAL_MS ?? 30000)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function manhattanDistance(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

async function requestJson(url, { method = 'GET', token = HUMAN_TOKEN, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const error = new Error(`Request failed: ${method} ${url} -> ${response.status}`)
    error.payload = data
    throw error
  }

  return data
}

async function getState() {
  const payload = await requestJson(`${API_BASE_URL}/state`)
  return payload.gameState
}

async function submitAction(action) {
  return requestJson(`${API_BASE_URL}/actions`, {
    method: 'POST',
    body: action,
  })
}

async function waitForCondition(label, predicate, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getState()
    if (predicate(state)) {
      return state
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for condition: ${label}`)
}

async function getServerPid() {
  try {
    const { stdout } = await execFileAsync('lsof', ['-tiTCP:3000', '-sTCP:LISTEN'])
    const pid = stdout.trim().split('\n')[0]
    return pid || null
  }
  catch {
    return null
  }
}

async function sampleProcess(pid) {
  if (!pid) {
    return null
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-p', pid, '-o', '%cpu=,rss='])
    const [cpuRaw, rssRaw] = stdout.trim().split(/\s+/)
    const cpu = Number(cpuRaw)
    const rssKb = Number(rssRaw)

    if (!Number.isFinite(cpu) || !Number.isFinite(rssKb)) {
      return null
    }

    return {
      at: new Date().toISOString(),
      cpu,
      rssKb,
    }
  }
  catch {
    return null
  }
}

function summarizeSamples(samples) {
  if (samples.length === 0) {
    return null
  }

  const cpuValues = samples.map((sample) => sample.cpu)
  const rssValues = samples.map((sample) => sample.rssKb)
  const sum = (values) => values.reduce((total, value) => total + value, 0)

  return {
    count: samples.length,
    cpuAvg: Number((sum(cpuValues) / cpuValues.length).toFixed(3)),
    cpuMax: Number(Math.max(...cpuValues).toFixed(3)),
    rssMbMin: Number((Math.min(...rssValues) / 1024).toFixed(3)),
    rssMbMax: Number((Math.max(...rssValues) / 1024).toFixed(3)),
    rssMbDelta: Number(((Math.max(...rssValues) - Math.min(...rssValues)) / 1024).toFixed(3)),
  }
}

async function main() {
  const result = {
    startedAt: new Date().toISOString(),
    durationMs: RUN_DURATION_MS,
    checkpoints: [],
    failures: [],
  }

  const pid = await getServerPid()
  result.serverPid = pid

  const initialState = await getState()
  result.initial = {
    tick: initialState.tick,
    status: initialState.status,
    towers: initialState.towers.length,
    enemies: initialState.enemies.length,
    waveIndex: initialState.wave?.index ?? 0,
    buildPaletteCount: initialState.buildPalette.length,
  }

  const buildType = initialState.buildPalette.find((entry) => entry.label.includes('箭塔'))?.type
    ?? initialState.buildPalette[0]?.type
  const levelThreeMagicType = initialState.buildPalette.find((entry) => entry.label.includes('魔法塔 3级'))?.type
    ?? buildType

  if (!buildType) {
    throw new Error('No buildable tower type found in build palette')
  }

  const pathCells = initialState.map.cells.filter((cell) => cell.kind === 'path' || cell.kind === 'gate' || cell.kind === 'core')
  const buildCells = initialState.map.cells
    .filter((cell) => cell.kind === 'build' && cell.buildable !== false)
    .map((cell) => ({
      ...cell,
      minDistanceToPath: pathCells.reduce((bestDistance, pathCell) => Math.min(bestDistance, manhattanDistance(cell, pathCell)), Number.POSITIVE_INFINITY),
    }))
    .sort((left, right) => left.minDistanceToPath - right.minDistanceToPath || left.y - right.y || left.x - right.x)

  if (buildCells.length < 20) {
    throw new Error(`Expected at least 20 candidate build cells, received ${buildCells.length}`)
  }

  const usedCellKeys = new Set()
  const reserveBuildCell = () => {
    const nextCell = buildCells.find((cell) => {
      const key = `${cell.x},${cell.y}`
      return !usedCellKeys.has(key)
    })

    if (!nextCell) {
      throw new Error('No remaining build cell candidates')
    }

    usedCellKeys.add(`${nextCell.x},${nextCell.y}`)
    return nextCell
  }

  const reserveFootprintCell = (width, height) => {
    const nextCell = buildCells.find((cell) => {
      for (let offsetY = 0; offsetY < height; offsetY += 1) {
        for (let offsetX = 0; offsetX < width; offsetX += 1) {
          const key = `${cell.x + offsetX},${cell.y + offsetY}`
          const footprintCell = buildCells.find((candidate) => candidate.x === cell.x + offsetX && candidate.y === cell.y + offsetY)
          if (!footprintCell || usedCellKeys.has(key)) {
            return false
          }
        }
      }

      return true
    })

    if (!nextCell) {
      throw new Error(`No remaining ${width}x${height} build cell candidates`)
    }

    for (let offsetY = 0; offsetY < height; offsetY += 1) {
      for (let offsetX = 0; offsetX < width; offsetX += 1) {
        usedCellKeys.add(`${nextCell.x + offsetX},${nextCell.y + offsetY}`)
      }
    }

    return nextCell
  }

  for (let index = 0; index < 4; index += 1) {
    const cell = reserveBuildCell()
    await submitAction({
      action: 'BUILD_TOWER',
      type: buildType,
      x: cell.x,
      y: cell.y,
    })
    await sleep(450)
  }

  for (let index = 0; index < 10; index += 1) {
    const cell = reserveBuildCell()
    await submitAction({
      action: 'BUILD_TOWER',
      type: levelThreeMagicType,
      x: cell.x,
      y: cell.y,
    })
    await sleep(450)
  }

  const stateAfterBuild = await waitForCondition('tower build settlement', (state) => state.towers.length >= 14)
  result.checkpoints.push({
    step: 'build',
    tick: stateAfterBuild.tick,
    towers: stateAfterBuild.towers.length,
  })

  const upgradeTargets = stateAfterBuild.towers.filter((tower) => tower.level === 1).slice(0, 4)
  for (const tower of upgradeTargets) {
    await submitAction({
      action: 'UPGRADE_TOWER',
      towerId: tower.id,
    })
    await sleep(450)
  }

  const stateAfterUpgrade = await waitForCondition('tower upgrade settlement', (state) => {
    return upgradeTargets.every((target) => {
      const nextTower = state.towers.find((tower) => tower.id === target.id)
      return nextTower && nextTower.level >= 2
    })
  })

  result.checkpoints.push({
    step: 'upgrade',
    tick: stateAfterUpgrade.tick,
    upgradedTowers: upgradeTargets.filter((target) => {
      const nextTower = stateAfterUpgrade.towers.find((tower) => tower.id === target.id)
      return nextTower && nextTower.level >= 2
    }).length,
  })

  const samples = []
  const observedWaveIndices = new Set([stateAfterUpgrade.wave?.index ?? 0])
  let finalState = stateAfterUpgrade
  let finishedAt = null
  const runStartedAt = Date.now()
  let nextSampleAt = runStartedAt
  let reinforcementCount = 0

  while (Date.now() - runStartedAt < RUN_DURATION_MS) {
    finalState = await getState()
    observedWaveIndices.add(finalState.wave?.index ?? 0)

    if (
      finalState.status === 'running'
      && reinforcementCount < 6
      && finalState.enemies.length >= 6
      && finalState.wave?.index !== undefined
      && finalState.wave.index <= 2
    ) {
      const cell = reserveBuildCell()
      await submitAction({
        action: 'BUILD_TOWER',
        type: levelThreeMagicType,
        x: cell.x,
        y: cell.y,
      })
      reinforcementCount += 1
      await sleep(450)
      continue
    }

    if (!finishedAt && finalState.status === 'finished') {
      finishedAt = new Date().toISOString()
      result.checkpoints.push({
        step: 'finished',
        tick: finalState.tick,
        outcome: finalState.result?.outcome ?? null,
        waveIndex: finalState.wave?.index ?? 0,
      })
    }

    if (Date.now() >= nextSampleAt) {
      const sample = await sampleProcess(pid)
      if (sample) {
        samples.push(sample)
      }
      nextSampleAt += SAMPLE_INTERVAL_MS
    }

    await sleep(POLL_INTERVAL_MS)
  }

  const leaderboardPayload = await requestJson(`${API_BASE_URL}/leaderboard?limit=8`)
  const replayListPayload = await requestJson(`${API_BASE_URL}/replays?limit=8`)
  const currentReplayPayload = await requestJson(`${API_BASE_URL}/replays/current`)
  const agentReplayListPayload = await requestJson(`${AGENT_API_BASE_URL}/replays`, { token: AGENT_TOKEN })
  const replayDetailPayload = replayListPayload.replays[0]
    ? await requestJson(`${API_BASE_URL}/replays/${replayListPayload.replays[0].matchId}`)
    : null

  result.finishedAt = new Date().toISOString()
  result.final = {
    tick: finalState.tick,
    status: finalState.status,
    result: finalState.result,
    towers: finalState.towers.length,
    enemies: finalState.enemies.length,
    waveIndex: finalState.wave?.index ?? 0,
    observedWaveIndices: [...observedWaveIndices].sort((left, right) => left - right),
  }

  result.leaderboard = {
    source: leaderboardPayload.source,
    humanCount: leaderboardPayload.leaderboards.human.length,
    agentCount: leaderboardPayload.leaderboards.agent.length,
    allCount: leaderboardPayload.leaderboards.all.length,
    topHuman: leaderboardPayload.leaderboards.human[0] ?? null,
  }

  result.replay = {
    listSource: replayListPayload.source,
    summaryCount: replayListPayload.replays.length,
    currentFrames: currentReplayPayload.replay.frames.length,
    currentActions: currentReplayPayload.replay.actions.length,
    currentMatchId: currentReplayPayload.replay.matchId,
    detailMatchId: replayDetailPayload?.replay?.matchId ?? null,
    agentListSource: agentReplayListPayload.replays ? 'ok' : 'missing',
  }

  result.process = summarizeSamples(samples)

  if (result.checkpoints.find((checkpoint) => checkpoint.step === 'build') === undefined) {
    result.failures.push('Build checkpoint missing')
  }

  if (result.checkpoints.find((checkpoint) => checkpoint.step === 'upgrade') === undefined) {
    result.failures.push('Upgrade checkpoint missing')
  }

  if (result.final.observedWaveIndices.filter((waveIndex) => waveIndex > 0).length < 2) {
    result.failures.push('Wave progression did not advance beyond initial wave')
  }

  if (result.final.status !== 'finished' || !result.final.result) {
    result.failures.push('Match did not settle to finished state within run duration')
  }

  if (result.leaderboard.humanCount < 1) {
    result.failures.push('Leaderboard did not contain human entry after run')
  }

  if (result.replay.summaryCount < 1 || result.replay.currentFrames < 1) {
    result.failures.push('Replay endpoints did not return recorded frames')
  }

  console.log(JSON.stringify(result, null, 2))

  if (result.failures.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    payload: error && typeof error === 'object' && 'payload' in error ? error.payload : undefined,
  }, null, 2))
  process.exitCode = 1
})