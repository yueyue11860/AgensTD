export type Difficulty = 'EASY' | 'NORMAL' | 'HARD' | 'HELL'

export type AgentStatus = 'active' | 'inactive' | 'training' | 'error'

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout'

export type RunEventType = 'queued' | 'started' | 'tick' | 'milestone' | 'completed' | 'failed' | 'timeout'

export type RankingTrend = 'up' | 'down' | 'stable'

export type GamePhase = 'PREP' | 'COMBAT' | 'RESOLUTION' | 'DECISION'

export type ActionType =
  | 'BUILD'
  | 'UPGRADE'
  | 'SELL'
  | 'MODULATE'
  | 'RETARGET'
  | 'CAST'
  | 'CONSUME'
  | 'REPAIR'
  | 'REROUTE'
  | 'BUY'
  | 'REFRESH_SHOP'
  | 'CHOOSE_OPTION'
  | 'PAUSE_OR_RESUME'
  | 'NO_OP'

export type ActionTargetKind = 'cell' | 'tower' | 'enemy' | 'route' | 'shop' | 'option' | 'global'

export type ActionAvailability = 'ready' | 'locked' | 'cooldown'

export type ActionWindowType = 'prep' | 'combat' | 'resolution' | 'decision'

export type PhaseTimeoutPolicy = 'auto_no_op'

export type ActionValidationCode =
  | 'observation_version_mismatch'
  | 'action_not_allowed'
  | 'issued_tick_stale'
  | 'issued_tick_outside_window'
  | 'unsupported_tower_core'
  | 'timeout_fallback'

export type CoreMapCellKind = 'path' | 'build' | 'blocked' | 'relay' | 'gate' | 'core' | 'hazard'

export type CoreTowerType = 'BALLISTA' | 'MORTAR' | 'FROST' | 'CURSE'

export type CoreTowerStatus = 'stable' | 'overdrive' | 'jammed' | 'corrupted'

export type CoreTargetMode = '前锋' | '重甲' | '热量最高' | '精英优先'

export type ThreatLevel = 'low' | 'medium' | 'high' | 'boss'

export type LaneLabel = '北' | '中' | '南'

export type RouteNodeType = 'combat' | 'elite' | 'shop' | 'event' | 'camp' | 'boss'

export type ObjectiveSeverity = 'info' | 'warning' | 'critical'

export type SimulationEventType =
  | 'phase_changed'
  | 'action_applied'
  | 'action_rejected'
  | 'wave_started'
  | 'wave_resolved'
  | 'resources_changed'
  | 'route_changed'
  | 'timeout_fallback'
  | 'run_completed'
  | 'run_failed'

export interface GridPoint {
  x: number
  y: number
}

export interface Agent {
  id: string
  name: string
  version: string
  owner: string
  created_at: string
  last_active: string
  total_runs: number
  win_rate: number
  avg_score: number
  status: AgentStatus
  avatar?: string
}

export interface Resources {
  gold: number
  heat: number
  heat_limit: number
  mana: number
  mana_limit: number
  repair: number
  threat: number
  fortress: number
  fortress_max: number
}

export type CoreResources = Resources

export interface Run {
  run_id: string
  agent_id: string
  agent_name: string
  difficulty: Difficulty
  seed: number
  status: RunStatus
  start_time: string
  end_time?: string
  duration_ms?: number
  current_tick: number
  max_ticks: number
  score: number
  wave: number
  max_wave: number
  resources: Resources
  towers_built: number
  enemies_killed: number
  damage_dealt: number
  damage_taken: number
  is_live: boolean
}

export interface Tower {
  id: string
  type: 'CANNON' | 'LASER' | 'FROST' | 'TESLA' | 'MISSILE' | 'FLAME'
  level: number
  position: GridPoint
  kills: number
  damage_dealt: number
  upgrades: number
  status: 'active' | 'charging' | 'overheated' | 'disabled'
}

export interface Enemy {
  id: string
  type: 'GRUNT' | 'TANK' | 'SWIFT' | 'HEALER' | 'BOSS' | 'ELITE'
  health: number
  max_health: number
  position: GridPoint
  speed: number
  armor: number
  status: 'moving' | 'attacking' | 'stunned' | 'dead'
}

export interface ReplaySnapshot {
  tick: number
  timestamp: string
  game_state: {
    resources: Resources
    towers: Tower[]
    enemies: Enemy[]
    wave: number
    score: number
  }
  thumbnail?: string
}

export interface CoreMapCell {
  x: number
  y: number
  kind: CoreMapCellKind
}

export interface CoreQuickActionSlot {
  key: 'Q' | 'W' | 'E' | 'R'
  actionId: string
  actionType: ActionType
  targetKind: ActionTargetKind
  label: string
  detail: string
  cost: string
  availability: ActionAvailability
  reason?: string
}

export interface CoreTowerBuild {
  id: string
  name: string
  role: string
  cell: GridPoint
  tier: number
  core: CoreTowerType
  status: CoreTowerStatus
  targetMode: CoreTargetMode
  modules: string[]
  heat: number
  dps: number
  note: string
  quickActions: CoreQuickActionSlot[]
}

export interface CoreEnemyWave {
  id: string
  name: string
  threat: ThreatLevel
  lane: LaneLabel
  count: number
  hp: number
  maxHp: number
  position: GridPoint
  intent: string
}

export interface CoreDecisionOption {
  id: string
  label: string
  cost: string
  payoff: string
  risk: string
  locked?: boolean
}

export interface RouteNodeState {
  id: string
  zone: number
  index: number
  type: RouteNodeType
  title: string
  modifier: string
  cleared: boolean
  active: boolean
}

export interface BuildQueueItem {
  id: string
  label: string
  eta: string
  reason: string
}

export interface RouteForecastItem {
  path: string
  reward: string
  cost: string
  risk: string
}

export interface ObjectiveItem {
  label: string
  detail: string
  severity: ObjectiveSeverity
}

export interface ActionWindow {
  type: ActionWindowType
  label: string
  deadlineMs: number
  summary: string
  options: CoreDecisionOption[]
  quickActions: CoreQuickActionSlot[]
}

export interface PhaseState {
  sequence: number
  started_at_tick: number
  deadline_tick: number
  timeout_policy: PhaseTimeoutPolicy
  window_type: ActionWindowType
}

export interface PhaseRule {
  phase: GamePhase
  window_type: ActionWindowType
  label: string
  tick_delta: number
  deadline_ms: number
  deadline_tick_delta: number
  timeout_policy: PhaseTimeoutPolicy
  allowed_actions: ActionType[]
}

export interface MvpBoundary {
  maps: number
  basic_tower_cores: CoreTowerType[]
  enemy_pool_size: number
  boss_pool_size: number
  difficulty_order: Difficulty[]
}

export interface CoreRunScenario {
  runId: string
  rulesVersion: string
  title: string
  agentName: string
  difficulty: Difficulty
  seed: number
  zoneName: string
  currentNode: string
  waveLabel: string
  currentTick: number
  maxTicks: number
  score: number
  fortressIntegrity: number
  maintenanceDebt: number
  routePressure: string
  resources: CoreResources
  supportedTowerCores: CoreTowerType[]
  routeNodes: RouteNodeState[]
  cells: CoreMapCell[]
  towers: CoreTowerBuild[]
  enemies: CoreEnemyWave[]
  relics: string[]
  buildQueue: BuildQueueItem[]
  actionWindow: ActionWindow
  routeForecast: RouteForecastItem[]
  objectiveStack: ObjectiveItem[]
}

export interface GameAction {
  action_type: ActionType
  target_kind: ActionTargetKind
  target_id?: string
  target_cell?: GridPoint
  payload?: Record<string, unknown>
  observation_version: number
  issued_at_tick: number
}

export interface GameObservation {
  run_id: string
  tick: number
  difficulty: Difficulty
  seed: number
  phase: GamePhase
  phase_state: PhaseState
  observation_version: number
  scenario: CoreRunScenario
  executable_actions: ActionType[]
  deadline_ms: number
}

export interface GameActionResult {
  accepted: boolean
  action: GameAction
  phase: GamePhase
  applied_tick: number
  validation_code?: ActionValidationCode
  reason?: string
  resource_delta?: Partial<CoreResources>
}

export interface CoreReplaySnapshot {
  tick: number
  timestamp: string
  game_state: {
    resources: CoreResources
    towers: CoreTowerBuild[]
    enemies: CoreEnemyWave[]
    wave: number
    score: number
    phase: GamePhase
    observation_version: number
  }
}

export interface SimulationEvent {
  type: SimulationEventType
  tick: number
  payload: Record<string, unknown>
}

export interface SimulatorState {
  phase: GamePhase
  phaseState: PhaseState
  observationVersion: number
  scenario: CoreRunScenario
  eventLog: SimulationEvent[]
}

export interface SeasonRanking {
  rank: number
  agent_id: string
  agent_name: string
  owner: string
  score: number
  wins: number
  losses: number
  win_rate: number
  avg_duration_ms: number
  highest_wave: number
  difficulty_cleared: Difficulty[]
  last_match: string
  trend: RankingTrend
  rank_change: number
}

export interface DifficultyProgress {
  difficulty: Difficulty
  unlocked: boolean
  cleared: boolean
  best_score: number
  best_wave: number
  attempts: number
  clear_rate: number
  requirements: string[]
}

export interface EnqueueRunPayload {
  agentId: string
  difficulty: Difficulty
  seed?: number
  maxTicks?: number
  seasonCode?: string
}

export interface EnqueueRunResult {
  runId: string
  runCode: string
  status: RunStatus
}

export interface RunResultSummary {
  summaryVersion?: number
  rulesVersion?: string
  title?: string
  zoneName?: string
  currentNode?: string
  waveLabel?: string
  fortressIntegrity?: number
  maintenanceDebt?: number
  routePressure?: string
  resources?: CoreResources
  supportedTowerCores?: CoreTowerType[]
  routeNodes?: RouteNodeState[]
  cells?: CoreMapCell[]
  towers?: CoreTowerBuild[]
  enemies?: CoreEnemyWave[]
  relics?: string[]
  buildQueue?: BuildQueueItem[]
  actionWindow?: ActionWindow
  routeForecast?: RouteForecastItem[]
  objectiveStack?: ObjectiveItem[]
  phase?: GamePhase
  phaseState?: PhaseState
  observationVersion?: number
  observation?: GameObservation
  lastAction?: GameActionResult
}

export interface RunEventPayload {
  difficulty?: Difficulty
  seed?: number
  max_ticks?: number
  phase?: GamePhase
  summary?: RunResultSummary
  snapshot?: CoreReplaySnapshot
  observation?: GameObservation
  action?: GameAction
  actionResult?: GameActionResult
  event?: SimulationEvent
  [key: string]: unknown
}

export interface ReportRunEventEntry {
  eventType: RunEventType
  tick?: number
  payload: RunEventPayload
}

export interface ReportRunProgressPayload {
  runId: string
  status: RunStatus
  startTime?: string
  endTime?: string
  durationMs?: number
  currentTick?: number
  maxTicks?: number
  score?: number
  wave?: number
  maxWave?: number
  resources?: Resources
  towersBuilt?: number
  enemiesKilled?: number
  damageDealt?: number
  damageTaken?: number
  isLive?: boolean
  errorMessage?: string
  resultSummary?: RunResultSummary
  eventType?: RunEventType
  eventPayload?: RunEventPayload
  eventBatch?: ReportRunEventEntry[]
  snapshot?: CoreReplaySnapshot
}