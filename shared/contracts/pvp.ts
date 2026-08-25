export type PvpSide = 'A' | 'B'

export type PvpMode = 'ranked_1v1' | 'casual_1v1' | 'custom_1v1'

export type PvpMatchPhase =
  | 'created'
  | 'waiting_players'
  | 'ready_check'
  | 'loading'
  | 'countdown'
  | 'playing'
  | 'settling'
  | 'completed'
  | 'voided'

export type PvpResultReason =
  | 'core_destroyed'
  | 'surrendered'
  | 'disconnect_forfeit'
  | 'simultaneous_draw'
  | 'hard_timeout'
  | 'server_void'
  | 'ruleset_invalid'

export type PvpParticipantResult = 'win' | 'loss' | 'draw' | 'void'

export interface PvpGridPosition {
  x: number
  y: number
}

export type PvpMapCellKind = 'deployable' | 'path' | 'spawn_gate' | 'core' | 'neutral_boundary'

export interface PvpMapCell extends PvpGridPosition {
  kind: PvpMapCellKind
  ownerSide: PvpSide | null
  deployable: boolean
  walkable: boolean
}

export interface PvpSideMapDefinition {
  side: PvpSide
  spawnGateCells: PvpGridPosition[]
  coreCells: PvpGridPosition[]
  routeAnchors: PvpGridPosition[]
  routeCells: PvpGridPosition[]
  deployableCells: PvpGridPosition[]
}

export interface PvpMapDefinition {
  mapId: 'pvp_dual_realm_v1' | string
  mapVersion: number
  width: 29 | number
  height: 29 | number
  neutralBoundaryY: number
  routeHash: string
  cells: PvpMapCell[]
  sides: Record<PvpSide, PvpSideMapDefinition>
}

export type PvpEnemyKind = 'base' | 'elite' | 'boss' | 'pressure'

export interface PvpEnemyState {
  enemyId: string
  side: PvpSide
  kind: PvpEnemyKind
  glyph: string
  roundNumber: number
  xMilli: number
  yMilli: number
  routeCellIndex: number
  routeProgressMilli: number
  hp: number
  maxHp: number
  armor: number
  magicResistance: number
  moveSpeedMilliCellsPerSecond: number
  coreDamage: number
  spawnProtected: boolean
  pressureSourcePlayerId: string | null
  pressureRequestId: string | null
}

export interface PvpPressureQueueEntry {
  pressureId: string
  senderPlayerId: string
  senderSide: PvpSide
  defenderSide: PvpSide
  requestId: string
  queuedAtTick: number
  roundNumber: number
  maxHp: number
}

export interface PvpParticipantStats {
  playerId: string
  side: PvpSide
  result: PvpParticipantResult | null
  coreHpRemaining: number
  baseKills: number
  pressureKills: number
  leaks: number
  scriptureEarned: number
  scriptureSpent: number
  pressureSent: number
  pressureLeaked: number
  coreDamageDealt: number
  rationsEarned: number
  rationsSpent: number
  paidRecruitCount: number
  activeGeneralIds: string[]
  peakPopulation: number
  highestSoldierLevel: number
  damageDealt: number
  controlDurationMs: number
}

export interface PvpBoardPieceState extends PvpGridPosition {
  entityId: string
  ownerPlayerId: string
  kind: 'soldier' | 'character'
  glyph: string
  soldierType?: 'blade' | 'spear' | 'bow' | 'cavalry'
  level?: 1 | 2 | 3 | 4 | 5
  formationId?: string
  generalId?: string
}

export interface PvpSidePrivateState {
  tray: Array<string | null>
  reserve: Array<string | null>
  pendingPressure: PvpPressureQueueEntry[]
  trayRevision: number
  reserveRevision: number
  boardRevision: number
}

export interface PvpSideState {
  side: PvpSide
  playerId: string
  playerName: string
  connected: boolean
  disconnectedAtTick: number | null
  ready: boolean
  loaded: boolean
  coreHp: number
  coreMaxHp: number
  rations: number
  scripture: number
  populationUsed: number
  populationCap: number
  boardPieces: PvpBoardPieceState[]
  enemies: PvpEnemyState[]
  stats: PvpParticipantStats
  privateState: PvpSidePrivateState
}

export interface PvpMatchResult {
  reason: PvpResultReason
  winnerPlayerId: string | null
  loserPlayerId: string | null
  decidedAtTick: number
  finalStateHash: string
  participants: Record<PvpSide, PvpParticipantResult>
}

export interface PvpRoundState {
  number: number
  nextRoundAtTick: number | null
  intervalTicks: number
  baseCountPerSide: number
}

export interface PvpTribulationState {
  active: boolean
  tier: number
  hpBonusBps: number
  moveSpeedBonusBps: number
  coreDamageBonus: number
  oneLeakDefeat: boolean
  hardTimeoutAtTick: number
}

export interface PvpRuntimeEvent {
  eventId: string
  tick: number
  type:
    | 'PHASE_CHANGED'
    | 'MATCH_STARTED'
    | 'ROUND_STARTED'
    | 'ROUND_RATIONS_GRANTED'
    | 'ENEMY_SPAWNED'
    | 'ENEMY_ENTERED_BATTLEFIELD'
    | 'ENEMY_DAMAGED'
    | 'ENEMY_KILLED'
    | 'PRESSURE_QUEUED'
    | 'PRESSURE_REJECTED'
    | 'PRESSURE_RESOLVED'
    | 'CORE_DAMAGED'
    | 'PLAYER_CONNECTION_CHANGED'
    | 'PLAYER_SURRENDERED'
    | 'PVP_MATCH_FINISHED'
    | 'PVP_MATCH_VOIDED'
  data: Record<string, string | number | boolean | null>
}

export interface PvpAuthorityState {
  schemaVersion: 1
  matchId: string
  mode: PvpMode
  phase: PvpMatchPhase
  tick: number
  tickRateMs: number
  seed: string
  rulesetVersion: string
  mapId: string
  mapVersion: number
  routeHash: string
  countdownRemainingTicks: number
  round: PvpRoundState
  tribulation: PvpTribulationState
  sides: Record<PvpSide, PvpSideState | null>
  result: PvpMatchResult | null
  recentEvents: PvpRuntimeEvent[]
}

export interface PvpProjectedSideState extends Omit<PvpSideState, 'privateState' | 'scripture' | 'rations'> {
  /** 只有本人投影包含精确经济；对手与观众为 null。 */
  rations: number | null
  scripture: number | null
  /**
   * 只有本人投影包含托盘与备战席；pendingPressure 在网络投影中始终为空。
   * 压力队列属于服务端权威状态，防守方只在妖怪实际出生后看到它。
   */
  privateState: PvpSidePrivateState | null
}

export interface PvpRealtimeState extends Omit<PvpAuthorityState, 'seed' | 'sides'> {
  viewerPlayerId: string | null
  sides: Record<PvpSide, PvpProjectedSideState | null>
}

export interface PvpCommandResult {
  ok: boolean
  code: string
  tick: number
  requestId?: string
  duplicate?: boolean
  details?: Record<string, string | number | boolean | null>
}

export interface PvpQueueJoinRequest {
  requestId: string
  mode: Extract<PvpMode, 'ranked_1v1' | 'casual_1v1'>
  region: string
  rulesetVersion: string
  loadoutVersion: number
}

export type PvpQueueTicketState = 'searching' | 'match_found' | 'accepted' | 'cancelled' | 'expired'

export interface PvpQueueTicket {
  ticketId: string
  playerId: string
  playerName: string
  mode: PvpQueueJoinRequest['mode']
  region: string
  rulesetVersion: string
  loadoutVersion: number
  state: PvpQueueTicketState
  createdAt: number
  searchStartedAt: number
  proposalId: string | null
  priorityReturn: boolean
}

export interface PvpMatchFound {
  proposalId: string
  mode: PvpQueueJoinRequest['mode']
  rulesetVersion: string
  region: string
  confirmDeadlineAt: number
  players: Array<{
    playerId: string
    playerName: string
    ticketId: string
    loadoutVersion: number
  }>
  acceptedPlayerIds: string[]
}

export interface PvpAcceptedMatch {
  matchId: string
  proposalId: string
  mode: PvpQueueJoinRequest['mode']
  rulesetVersion: string
  region: string
  players: Array<{
    playerId: string
    playerName: string
    ticketId: string
    side: PvpSide
    loadoutVersion: number
  }>
  acceptedAt: number
}
