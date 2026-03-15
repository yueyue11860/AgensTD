import type {
  ActionType,
  ActionWindowType,
  CoreTowerType,
  Difficulty,
  GamePhase,
  MvpBoundary,
  PhaseRule,
  PhaseState,
} from '../domain.ts'

export const MVP_DIFFICULTY_ORDER: Difficulty[] = ['EASY', 'NORMAL', 'HARD', 'HELL']

export const MVP_CORE_TOWER_TYPES: CoreTowerType[] = ['ARROW', 'ICE', 'CANNON', 'LASER', 'TESLA', 'MAGIC', 'SUPPLY', 'MINE']

export const MVP_BOUNDARY: MvpBoundary = {
  maps: 1,
  basic_tower_cores: MVP_CORE_TOWER_TYPES,
  enemy_pool_size: 12,
  boss_pool_size: 2,
  difficulty_order: MVP_DIFFICULTY_ORDER,
}

export const PHASE_ORDER: GamePhase[] = ['PREP', 'COMBAT', 'RESOLUTION', 'DECISION']

const PHASE_LABELS: Record<ActionWindowType, string> = {
  prep: '波前准备',
  combat: '波中干预',
  resolution: '波后结算',
  decision: '节点决策',
}

export const PHASE_RULES: Record<GamePhase, PhaseRule> = {
  PREP: {
    phase: 'PREP',
    window_type: 'prep',
    label: PHASE_LABELS.prep,
    tick_delta: 480,
    deadline_ms: 6000,
    deadline_tick_delta: 480,
    timeout_policy: 'auto_no_op',
    allowed_actions: ['BUILD', 'UPGRADE', 'SELL', 'MODULATE', 'RETARGET', 'REPAIR', 'REROUTE', 'BUY', 'NO_OP'],
  },
  COMBAT: {
    phase: 'COMBAT',
    window_type: 'combat',
    label: PHASE_LABELS.combat,
    tick_delta: 360,
    deadline_ms: 4200,
    deadline_tick_delta: 360,
    timeout_policy: 'auto_no_op',
    allowed_actions: ['CAST', 'RETARGET', 'CONSUME', 'REPAIR', 'PAUSE_OR_RESUME', 'NO_OP'],
  },
  RESOLUTION: {
    phase: 'RESOLUTION',
    window_type: 'resolution',
    label: PHASE_LABELS.resolution,
    tick_delta: 240,
    deadline_ms: 2800,
    deadline_tick_delta: 240,
    timeout_policy: 'auto_no_op',
    allowed_actions: ['NO_OP', 'REPAIR', 'BUY'],
  },
  DECISION: {
    phase: 'DECISION',
    window_type: 'decision',
    label: PHASE_LABELS.decision,
    tick_delta: 600,
    deadline_ms: 5200,
    deadline_tick_delta: 600,
    timeout_policy: 'auto_no_op',
    allowed_actions: ['CHOOSE_OPTION', 'BUY', 'REFRESH_SHOP', 'NO_OP'],
  },
}

export function createPhaseState(phase: GamePhase, startedAtTick: number, sequence = 1): PhaseState {
  const rule = PHASE_RULES[phase]

  return {
    sequence,
    started_at_tick: startedAtTick,
    deadline_tick: startedAtTick + rule.deadline_tick_delta,
    timeout_policy: rule.timeout_policy,
    window_type: rule.window_type,
  }
}

export function getActionWindowLabel(phase: GamePhase) {
  const rule = PHASE_RULES[phase]
  return `${rule.label} / ${Math.round(rule.deadline_ms / 100) / 10} 秒`
}

export function isSupportedTowerCore(value: unknown): value is CoreTowerType {
  return typeof value === 'string' && MVP_CORE_TOWER_TYPES.includes(value as CoreTowerType)
}

export function getAllowedActions(phase: GamePhase): ActionType[] {
  return PHASE_RULES[phase].allowed_actions
}