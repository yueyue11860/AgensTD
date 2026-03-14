import {
  type ActionType,
  type ActionValidationCode,
  type CoreReplaySnapshot,
  type CoreResources,
  type CoreRunScenario,
  type GameAction,
  type GameActionResult,
  type GameObservation,
  type GamePhase,
  type RunResultSummary,
  type SimulationEvent,
  type SimulatorState,
} from '../domain.ts'
import {
  createPhaseState,
  getActionWindowLabel,
  isSupportedTowerCore,
  MVP_CORE_TOWER_TYPES,
  PHASE_ORDER,
  PHASE_RULES,
} from './rules.ts'
import { buildReplaySnapshot, buildRunResultSummary } from './replay.ts'
import { mockCoreScenario } from '../mock-data.ts'

interface SimulatorOptions {
  scenario?: CoreRunScenario
  phase?: GamePhase
  seed?: number
}

export interface SimulatorStepResult {
  actionResult: GameActionResult
  observation: GameObservation
  snapshot: CoreReplaySnapshot
  summary: RunResultSummary
  events: SimulationEvent[]
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function mulberry32(seed: number) {
  let current = seed >>> 0
  return () => {
    current += 0x6d2b79f5
    let t = current
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function nextPhase(phase: GamePhase): GamePhase {
  const currentIndex = PHASE_ORDER.indexOf(phase)
  return PHASE_ORDER[(currentIndex + 1) % PHASE_ORDER.length] ?? 'PREP'
}

function parseWaveNumber(label: string) {
  const match = label.match(/Wave\s+(\d+)/i)
  return match ? Number(match[1]) : 1
}

function updateWaveLabel(label: string, nextWave: number) {
  if (/Wave\s+\d+/i.test(label)) {
    return label.replace(/Wave\s+\d+/i, `Wave ${nextWave}`)
  }

  return `Wave ${nextWave}`
}

function buildResourceDelta(action: GameAction): Partial<CoreResources> {
  switch (action.action_type) {
    case 'BUILD':
      return { gold: -90, repair: -1, threat: -4 }
    case 'UPGRADE':
      return { gold: -120, heat: 6, threat: -5 }
    case 'SELL':
      return { gold: 60, repair: -1, threat: 2 }
    case 'MODULATE':
      return { gold: -55, mana: -12, heat: 4 }
    case 'RETARGET':
      return { threat: -3 }
    case 'CAST':
      return { mana: -24, heat: -8, threat: -7 }
    case 'CONSUME':
      return { mana: -10, threat: -4 }
    case 'REPAIR':
      return { repair: -2, fortress: 8, threat: -5 }
    case 'REROUTE':
      return { gold: -35, repair: -2, threat: -8 }
    case 'BUY':
      return { gold: -80 }
    case 'REFRESH_SHOP':
      return { gold: -25 }
    case 'CHOOSE_OPTION':
      return { mana: -6, repair: -1, threat: -2 }
    case 'PAUSE_OR_RESUME':
      return { threat: -1 }
    case 'NO_OP':
      return { heat: 2, threat: 3 }
    default:
      return {}
  }
}

function applyResourceDelta(resources: CoreResources, delta: Partial<CoreResources>) {
  return {
    gold: clamp(resources.gold + (delta.gold ?? 0), 0, 9999),
    heat: clamp(resources.heat + (delta.heat ?? 0), 0, resources.heat_limit),
    heat_limit: resources.heat_limit,
    mana: clamp(resources.mana + (delta.mana ?? 0), 0, resources.mana_limit),
    mana_limit: resources.mana_limit,
    repair: clamp(resources.repair + (delta.repair ?? 0), 0, 99),
    threat: clamp(resources.threat + (delta.threat ?? 0), 0, 100),
    fortress: clamp(resources.fortress + (delta.fortress ?? 0), 0, resources.fortress_max),
    fortress_max: resources.fortress_max,
  }
}

function syncActionWindow(scenario: CoreRunScenario, phase: GamePhase) {
  const config = PHASE_RULES[phase]

  scenario.actionWindow = {
    ...scenario.actionWindow,
    type: config.window_type,
    label: getActionWindowLabel(phase),
    deadlineMs: config.deadline_ms,
  }
}

export class GameSimulator {
  private readonly random: () => number

  private state: SimulatorState

  constructor(options: SimulatorOptions = {}) {
    const scenario = cloneValue(options.scenario ?? mockCoreScenario)
    const phase = options.phase ?? 'PREP'

    syncActionWindow(scenario, phase)

    this.random = mulberry32(options.seed ?? scenario.seed)
    this.state = {
      phase,
      phaseState: createPhaseState(phase, scenario.currentTick),
      observationVersion: 1,
      scenario: {
        ...scenario,
        supportedTowerCores: [...MVP_CORE_TOWER_TYPES],
      },
      eventLog: [],
    }
  }

  getState() {
    return cloneValue(this.state)
  }

  getObservation(): GameObservation {
    const config = PHASE_RULES[this.state.phase]

    return {
      run_id: this.state.scenario.runId,
      tick: this.state.scenario.currentTick,
      difficulty: this.state.scenario.difficulty,
      seed: this.state.scenario.seed,
      phase: this.state.phase,
      phase_state: cloneValue(this.state.phaseState),
      observation_version: this.state.observationVersion,
      scenario: cloneValue(this.state.scenario),
      executable_actions: [...config.allowed_actions],
      deadline_ms: config.deadline_ms,
    }
  }

  step(action?: GameAction): SimulatorStepResult {
    const isTimeoutFallback = !action
    const pendingAction = action ?? this.createNoOpAction()
    const beforeEventCount = this.state.eventLog.length
    const actionResult = this.submitAction(pendingAction, isTimeoutFallback ? 'timeout_fallback' : undefined)

    this.advancePhase()

    return {
      actionResult,
      observation: this.getObservation(),
      snapshot: this.createSnapshot(),
      summary: this.getResultSummary(actionResult),
      events: cloneValue(this.state.eventLog.slice(beforeEventCount)),
    }
  }

  getResultSummary(lastAction?: GameActionResult) {
    return buildRunResultSummary(this.getObservation(), lastAction)
  }

  submitAction(action: GameAction, fallbackCode?: Extract<ActionValidationCode, 'timeout_fallback'>): GameActionResult {
    const config = PHASE_RULES[this.state.phase]

    if (action.observation_version !== this.state.observationVersion) {
      const result = this.rejectAction(action, 'observation_version mismatch', 'observation_version_mismatch')
      return result
    }

    if (!config.allowed_actions.includes(action.action_type)) {
      return this.rejectAction(action, `${action.action_type} is not allowed during ${this.state.phase}`, 'action_not_allowed')
    }

    if (action.issued_at_tick < this.state.phaseState.started_at_tick) {
      return this.rejectAction(action, 'issued_at_tick is older than current phase start', 'issued_tick_stale')
    }

    if (action.issued_at_tick > this.state.phaseState.deadline_tick) {
      return this.rejectAction(action, 'issued_at_tick exceeds phase deadline', 'issued_tick_outside_window')
    }

    if (action.action_type === 'BUILD' && action.payload?.core && !isSupportedTowerCore(action.payload.core)) {
      return this.rejectAction(action, 'tower core is outside MVP boundary', 'unsupported_tower_core')
    }

    const delta = buildResourceDelta(action)
    const nextResources = applyResourceDelta(this.state.scenario.resources, delta)
    const previousResources = this.state.scenario.resources

    if (previousResources.gold > 0 && nextResources.gold === 0 && (delta.gold ?? 0) < 0) {
      this.pushEvent('resources_changed', {
        from: cloneValue(previousResources),
        to: cloneValue(nextResources),
        reason: 'gold_floor_reached',
      })
    }

    this.state.scenario.resources = nextResources
    this.state.scenario.fortressIntegrity = nextResources.fortress
    this.state.scenario.score = clamp(
      this.state.scenario.score + Math.round(this.random() * 120) + this.scoreDeltaForAction(action.action_type),
      0,
      999999,
    )
    this.state.scenario.maintenanceDebt = clamp(
      this.state.scenario.maintenanceDebt + ((delta.repair ?? 0) < 0 ? 1 : 0) - ((delta.fortress ?? 0) > 0 ? 1 : 0),
      0,
      99,
    )
    this.state.observationVersion += 1

    const result: GameActionResult = {
      accepted: true,
      action,
      phase: this.state.phase,
      applied_tick: this.state.scenario.currentTick,
      validation_code: fallbackCode,
      reason: fallbackCode === 'timeout_fallback' ? 'deadline reached, simulator applied NO_OP fallback' : undefined,
      resource_delta: delta,
    }

    if (Object.keys(delta).length > 0) {
      this.pushEvent('resources_changed', {
        from: cloneValue(previousResources),
        to: cloneValue(nextResources),
        delta,
      })
    }

    if (fallbackCode === 'timeout_fallback') {
      this.pushEvent('timeout_fallback', {
        phase: this.state.phase,
        action,
        timeout_policy: this.state.phaseState.timeout_policy,
      })
    }

    this.pushEvent('action_applied', {
      action,
      resource_delta: delta,
      phase: this.state.phase,
      observation_version: this.state.observationVersion,
      validation_code: fallbackCode,
    })

    return result
  }

  createSnapshot(): CoreReplaySnapshot {
    return buildReplaySnapshot(this.state.scenario, this.state.phase, this.state.observationVersion)
  }

  private advancePhase() {
    const previousPhase = this.state.phase
    const next = nextPhase(previousPhase)
    const previousPhaseRule = PHASE_RULES[previousPhase]

    this.state.scenario.currentTick = Math.min(
      this.state.scenario.maxTicks,
      this.state.scenario.currentTick + previousPhaseRule.tick_delta,
    )

    if (next === 'COMBAT') {
      const threatBump = Math.round(this.random() * 6) + 3
      const heatBump = Math.round(this.random() * 5) + 2
      this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, {
        heat: heatBump,
        threat: threatBump,
      })
      this.pushEvent('wave_started', {
        threat_bump: threatBump,
        heat_bump: heatBump,
      })
    }

    if (next === 'RESOLUTION') {
      const fortressLoss = Math.round(this.random() * 4)
      const goldGain = 50 + Math.round(this.random() * 30)
      this.state.scenario.resources = applyResourceDelta(this.state.scenario.resources, {
        gold: goldGain,
        fortress: -fortressLoss,
        heat: -6,
        threat: -4,
      })
      this.state.scenario.fortressIntegrity = this.state.scenario.resources.fortress
      this.pushEvent('wave_resolved', {
        fortress_loss: fortressLoss,
        gold_gain: goldGain,
      })
    }

    if (next === 'DECISION') {
      const currentWave = parseWaveNumber(this.state.scenario.waveLabel)
      this.state.scenario.waveLabel = updateWaveLabel(this.state.scenario.waveLabel, currentWave + 1)
    }

    this.state.phase = next
    this.state.phaseState = createPhaseState(next, this.state.scenario.currentTick, this.state.phaseState.sequence + 1)
    syncActionWindow(this.state.scenario, next)
    this.state.observationVersion += 1

    this.pushEvent('phase_changed', {
      from: previousPhase,
      to: next,
      tick: this.state.scenario.currentTick,
      phase_sequence: this.state.phaseState.sequence,
    })
  }

  private createNoOpAction(): GameAction {
    return {
      action_type: 'NO_OP',
      target_kind: 'global',
      observation_version: this.state.observationVersion,
      issued_at_tick: this.state.scenario.currentTick,
    }
  }

  private pushEvent(type: SimulationEvent['type'], payload: Record<string, unknown>) {
    this.state.eventLog.push({
      type,
      tick: this.state.scenario.currentTick,
      payload,
    })
  }

  private rejectAction(action: GameAction, reason: string, validationCode: ActionValidationCode): GameActionResult {
    const result: GameActionResult = {
      accepted: false,
      action,
      phase: this.state.phase,
      applied_tick: this.state.scenario.currentTick,
      validation_code: validationCode,
      reason,
    }

    this.pushEvent('action_rejected', {
      action,
      reason,
      phase: this.state.phase,
      validation_code: validationCode,
    })

    return result
  }

  private scoreDeltaForAction(actionType: ActionType) {
    switch (actionType) {
      case 'BUILD':
      case 'UPGRADE':
      case 'CAST':
      case 'REROUTE':
        return 180
      case 'CHOOSE_OPTION':
      case 'BUY':
      case 'REPAIR':
        return 90
      case 'NO_OP':
        return 0
      default:
        return 40
    }
  }
}

export function createSimulator(options: SimulatorOptions = {}) {
  return new GameSimulator(options)
}