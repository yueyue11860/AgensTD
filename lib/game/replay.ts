import type { CoreReplaySnapshot, CoreRunScenario, GameActionResult, GameObservation, RunResultSummary } from '../domain.ts'

function parseWaveNumber(label: string) {
  const match = label.match(/Wave\s+(\d+)/i)
  return match ? Number(match[1]) : 1
}

export function createDeterministicTimestamp(seed: number, tick: number) {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0) + (Math.abs(seed) % 86400) * 1000
  return new Date(base + tick * 100).toISOString()
}

export function buildReplaySnapshot(
  scenario: CoreRunScenario,
  phase: GameObservation['phase'],
  observationVersion: number,
): CoreReplaySnapshot {
  return {
    tick: scenario.currentTick,
    timestamp: createDeterministicTimestamp(scenario.seed, scenario.currentTick),
    game_state: {
      resources: { ...scenario.resources },
      towers: scenario.towers.map((tower) => ({ ...tower, cell: { ...tower.cell }, quickActions: tower.quickActions.map((slot) => ({ ...slot })) })),
      enemies: scenario.enemies.map((enemy) => ({ ...enemy, position: { ...enemy.position } })),
      wave: parseWaveNumber(scenario.waveLabel),
      score: scenario.score,
      phase,
      observation_version: observationVersion,
    },
  }
}

export function buildRunResultSummary(observation: GameObservation, lastAction?: GameActionResult): RunResultSummary {
  const scenario = observation.scenario

  return {
    summaryVersion: 1,
    rulesVersion: scenario.rulesVersion,
    title: scenario.title,
    zoneName: scenario.zoneName,
    currentNode: scenario.currentNode,
    waveLabel: scenario.waveLabel,
    fortressIntegrity: scenario.fortressIntegrity,
    maintenanceDebt: scenario.maintenanceDebt,
    routePressure: scenario.routePressure,
    resources: { ...scenario.resources },
    supportedTowerCores: [...scenario.supportedTowerCores],
    routeNodes: scenario.routeNodes.map((node) => ({ ...node })),
    cells: scenario.cells.map((cell) => ({ ...cell })),
    towers: scenario.towers.map((tower) => ({ ...tower, cell: { ...tower.cell }, quickActions: tower.quickActions.map((slot) => ({ ...slot })) })),
    enemies: scenario.enemies.map((enemy) => ({ ...enemy, position: { ...enemy.position } })),
    relics: [...scenario.relics],
    buildQueue: scenario.buildQueue.map((item) => ({ ...item })),
    actionWindow: {
      ...scenario.actionWindow,
      options: scenario.actionWindow.options.map((option) => ({ ...option })),
      quickActions: scenario.actionWindow.quickActions.map((slot) => ({ ...slot })),
    },
    routeForecast: scenario.routeForecast.map((item) => ({ ...item })),
    objectiveStack: scenario.objectiveStack.map((item) => ({ ...item })),
    phase: observation.phase,
    phaseState: { ...observation.phase_state },
    observationVersion: observation.observation_version,
    observation: {
      ...observation,
      phase_state: { ...observation.phase_state },
      scenario: {
        ...scenario,
        resources: { ...scenario.resources },
        supportedTowerCores: [...scenario.supportedTowerCores],
        routeNodes: scenario.routeNodes.map((node) => ({ ...node })),
        cells: scenario.cells.map((cell) => ({ ...cell })),
        towers: scenario.towers.map((tower) => ({ ...tower, cell: { ...tower.cell }, quickActions: tower.quickActions.map((slot) => ({ ...slot })) })),
        enemies: scenario.enemies.map((enemy) => ({ ...enemy, position: { ...enemy.position } })),
        relics: [...scenario.relics],
        buildQueue: scenario.buildQueue.map((item) => ({ ...item })),
        actionWindow: {
          ...scenario.actionWindow,
          options: scenario.actionWindow.options.map((option) => ({ ...option })),
          quickActions: scenario.actionWindow.quickActions.map((slot) => ({ ...slot })),
        },
        routeForecast: scenario.routeForecast.map((item) => ({ ...item })),
        objectiveStack: scenario.objectiveStack.map((item) => ({ ...item })),
      },
      executable_actions: [...observation.executable_actions],
    },
    lastAction: lastAction
      ? {
          ...lastAction,
          action: {
            ...lastAction.action,
            payload: lastAction.action.payload ? { ...lastAction.action.payload } : undefined,
            target_cell: lastAction.action.target_cell ? { ...lastAction.action.target_cell } : undefined,
          },
          resource_delta: lastAction.resource_delta ? { ...lastAction.resource_delta } : undefined,
        }
      : undefined,
  }
}