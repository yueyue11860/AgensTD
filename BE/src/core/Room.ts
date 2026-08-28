import type { ServerConfig } from '../config/server-config'
import {
  ARENA_GRID_SIZE,
  createArenaEnemyLanePath,
  createArenaMapCells,
  getArenaLaneSpawnPoint,
  getArenaLoopStartIndex,
  getArenaPrimaryBasePoint,
  getArenaPrimarySpawnPoint,
  WAYPOINTS_MAP,
} from '../config/arena-layout'
import type { Position } from '../domain/game-state'
import type { GridMapCell } from './grid-map'
import { GridMap } from './grid-map'
import { GameEngine, type EngineLaneRoute, type EngineSlotId } from './game-engine'
import type { PveStageSelection } from '../../../shared/contracts/pve-stage-config'
import type {
  MatchBuildDefinitionResolver,
  MatchBuildSnapshot,
  MatchPlayerSettlement,
  SettlementReason,
} from '../account-v1/types'
import type { PlayerAccountService } from '../account-v1/service'
import { createPasswordCredential, verifyPassword, type PasswordCredential } from '../security/password'

export type RoomPhase = 'lobby' | 'countdown' | 'waiting_for_level' | 'playing'

export const ROOM_SLOT_ORDER = ['P1', 'P2', 'P3', 'P4'] as const satisfies readonly EngineSlotId[]

export interface RoomCreateOptions {
  displayName?: string
  /** Plaintext is accepted only at the creation boundary and immediately converted to a hash. */
  password?: string
  /** @deprecated Use `password`; a boolean cannot secure a room and is rejected when true. */
  hasPassword?: boolean
}

export interface RoomAccountRuntime {
  accountService: PlayerAccountService
  buildResolver: MatchBuildDefinitionResolver
}

export interface RoomSlotSnapshot {
  slotId: EngineSlotId
  playerId: string | null
  playerName: string | null
  connected: boolean
  connectionState: 'connected' | 'reconnecting' | 'disconnected'
  isHost: boolean
}

export interface RoomSummarySnapshot {
  id: string
  name: string
  hasPassword: boolean
  players: number
  maxPlayers: number
  phase: RoomPhase
  slots: RoomSlotSnapshot[]
}

export interface RoomLayout {
  width: number
  height: number
  hub: Position
  primarySpawn: Position
  cells: GridMapCell[][]
  laneRoutes: Record<EngineSlotId, EngineLaneRoute>
}

const MIN_ROOM_WIDTH = ARENA_GRID_SIZE
const MIN_ROOM_HEIGHT = ARENA_GRID_SIZE

const HUB: Position = getArenaPrimaryBasePoint()

function createLaneRoutes(pathGrid: GridMap): Record<EngineSlotId, EngineLaneRoute> {
  function createLaneRoute(slot: EngineSlotId): EngineLaneRoute {
    const spawn = getArenaLaneSpawnPoint(slot)
    const path = createArenaEnemyLanePath(slot)
    const loopStartIndex = getArenaLoopStartIndex(WAYPOINTS_MAP[slot])

    return {
      slot,
      spawn,
      path,
      loopStartIndex,
    }
  }

  return {
    P1: createLaneRoute('P1'),
    P2: createLaneRoute('P2'),
    P3: createLaneRoute('P3'),
    P4: createLaneRoute('P4'),
  }
}

export function createFixedRoomLayout(width: number, height: number): RoomLayout {
  if (width < MIN_ROOM_WIDTH || height < MIN_ROOM_HEIGHT) {
    throw new Error(`Arena room requires at least ${MIN_ROOM_WIDTH}x${MIN_ROOM_HEIGHT} cells`)
  }

  const cells: GridMapCell[][] = createArenaMapCells(width, height)
  const pathGrid = new GridMap(cells, getArenaPrimarySpawnPoint(), HUB)
  const laneRoutes = createLaneRoutes(pathGrid)

  return {
    width,
    height,
    hub: { ...HUB },
    primarySpawn: { ...laneRoutes.P1.spawn },
    cells,
    laneRoutes,
  }
}

export class Room {
  readonly id: string

  readonly layout: RoomLayout

  readonly engine: GameEngine

  private readonly slotAssignments = new Map<EngineSlotId, string>()

  // 房间生命周期状态机
  private phase: RoomPhase = 'lobby'

  private readonly displayName: string

  private passwordCredential: PasswordCredential | null

  // 第一个加入的玩家为房主
  private hostPlayerId: string | null = null

  // 倒计时定时器句柄（idle 时务必清除）
  private countdownTimer: NodeJS.Timeout | null = null

  private countdownPreparing = false

  private pendingStageSelection: PveStageSelection | null = null

  private activeStageSelection: PveStageSelection | null = null

  /**
   * 结算与奖励是异步执行的；按 matchId 保留关卡快照，避免玩家立即重开时
   * 把上一局的奖励写到新一局所选关卡。
   */
  private readonly stageSelectionsByMatchId = new Map<string, PveStageSelection>()

  private readonly matchBuildSnapshots = new Map<string, MatchBuildSnapshot>()

  constructor(
    id: string,
    config: ServerConfig,
    options?: RoomCreateOptions,
    private readonly accountRuntime?: RoomAccountRuntime,
  ) {
    this.id = id
    this.displayName = options?.displayName?.trim() || id
    if (options?.hasPassword === true && !options.password) throw new Error('ROOM_PASSWORD_REQUIRED')
    if (options?.password && options.password.length > 128) throw new Error('ROOM_PASSWORD_TOO_LONG')
    this.passwordCredential = options?.password ? createPasswordCredential(options.password) : null
    this.layout = createFixedRoomLayout(config.mapWidth, config.mapHeight)
    this.engine = new GameEngine(
      {
        ...config,
        matchId: `${config.matchId}:${id}`,
      },
      {
        roomId: id,
        playerCount: 1,
        activeSlots: ['P1'],
        mapCells: this.layout.cells,
        laneRoutes: this.layout.laneRoutes,
        spawnPoint: this.layout.primarySpawn,
        basePoint: this.layout.hub,
        spawnMultiplier: 1,
      },
    )
  }

  requiresPassword(): boolean {
    return this.passwordCredential !== null
  }

  verifyJoinPassword(password: string): boolean {
    return this.passwordCredential === null || verifyPassword(password, this.passwordCredential)
  }

  joinPlayer(playerId: string) {
    const existingSlot = this.getPlayerSlot(playerId)
    if (existingSlot) {
      return existingSlot
    }

    // 构筑在倒计时前已锁定；只允许旧玩家重连，不允许陌生玩家插入。
    if (!this.isAcceptingNewPlayers()) {
      return null
    }

    const openSlot = ROOM_SLOT_ORDER.find((slot) => !this.slotAssignments.has(slot))
    if (!openSlot) {
      return null
    }

    this.slotAssignments.set(openSlot, playerId)

    // 第一个进入的玩家为房主
    if (!this.hostPlayerId) {
      this.hostPlayerId = playerId
    }

    this.syncEngineRoomRules()
    return openSlot
  }

  leavePlayer(playerId: string) {
    const slot = this.getPlayerSlot(playerId)
    if (!slot) {
      return false
    }

    this.slotAssignments.delete(slot)

    // 房主离开时，将房主权移交给第一个剩余玩家
    if (this.hostPlayerId === playerId) {
      this.hostPlayerId = this.getFirstAssignedPlayerId()
    }

    this.syncEngineRoomRules()
    return true
  }

  getPlayerCount() {
    return Math.max(1, this.slotAssignments.size)
  }

  getPlayerSlot(playerId: string) {
    for (const [slot, assignedPlayerId] of this.slotAssignments.entries()) {
      if (assignedPlayerId === playerId) {
        return slot
      }
    }

    return null
  }

  getActiveSlots() {
    const activeSlots = ROOM_SLOT_ORDER.filter((slot) => this.slotAssignments.has(slot))
    return activeSlots.length > 0 ? activeSlots : (['P1'] as EngineSlotId[])
  }

  isEmpty() {
    return this.slotAssignments.size === 0
  }

  getPhase(): RoomPhase {
    if (this.phase === 'playing' && this.engine.isMatchFinished()) {
      return 'lobby'
    }

    return this.phase
  }

  isAcceptingNewPlayers(): boolean {
    return this.getPhase() === 'lobby' && !this.countdownPreparing
  }

  getHostPlayerId(): string | null {
    return this.hostPlayerId
  }

  /** 返回当前房间内全部玩家 ID 列表 */
  getConnectedPlayerIds(): string[] {
    const connected = new Set(this.engine.getStateSnapshot().players
      .filter(player => player.connectionStatus === 'connected')
      .map(player => player.id))
    return [...this.slotAssignments.values()].filter(playerId => connected.has(playerId))
  }

  getSummary(): RoomSummarySnapshot {
    const players = this.engine.getStateSnapshot().players

    return {
      id: this.id,
      name: this.displayName,
      hasPassword: this.passwordCredential !== null,
      players: this.slotAssignments.size,
      maxPlayers: ROOM_SLOT_ORDER.length,
      phase: this.getPhase(),
      slots: ROOM_SLOT_ORDER.map((slotId) => {
        const playerId = this.slotAssignments.get(slotId) ?? null
        const player = playerId
          ? players.find((candidate) => candidate.id === playerId) ?? null
          : null

        return {
          slotId,
          playerId,
          playerName: player?.name ?? null,
          connected: player?.connectionStatus === 'connected',
          connectionState: player?.connectionStatus ?? 'disconnected',
          isHost: playerId !== null && playerId === this.hostPlayerId,
        }
      }),
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 生命周期状态机
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 房主按下开始，进入倒计时阶段。
   * - 合法前置：phase === 'lobby'  且 requestorPlayerId === hostPlayerId
   * - `onComplete` 在 3 秒后自动触发，应由 SocketGateway 向全房广播状态变化
   * @returns 'ok' | 'wrong_phase' | 'forbidden'
   */
  async beginCountdown(
    requestorPlayerId: string,
    onComplete: () => void,
  ): Promise<'ok' | 'wrong_phase' | 'forbidden' | 'snapshot_failed'> {
    if (this.getPhase() !== 'lobby') {
      return 'wrong_phase'
    }

    if (this.countdownPreparing) return 'wrong_phase'

    if (requestorPlayerId !== this.hostPlayerId) {
      return 'forbidden'
    }

    if (this.phase === 'playing' && !this.engine.resetForRematch()) {
      return 'wrong_phase'
    }

    this.countdownPreparing = true
    try {
      await this.lockMatchBuildSnapshots()
    }
    catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      console.error(`Room ${this.id} failed to lock match build snapshots: ${details}`)
      return 'snapshot_failed'
    }
    finally {
      this.countdownPreparing = false
    }

    this.phase = 'countdown'
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null
      this.phase = 'waiting_for_level'
      onComplete()
    }, 3000)

    return 'ok'
  }

  /** 校验通过后以权威 PVE V2 关卡选择点火；不接受 legacy waves/startingGold。 */
  ignitePveV2(selection: PveStageSelection): void {
    this.pendingStageSelection = null
    this.activeStageSelection = structuredClone(selection)
    this.phase = 'playing'
    this.engine.ignitePveV2(selection.levelId, selection.difficulty)
    this.stageSelectionsByMatchId.set(
      this.engine.getStateSnapshot().matchId,
      structuredClone(selection),
    )
  }

  getMatchBuildSnapshot(playerId: string): MatchBuildSnapshot | null {
    const snapshot = this.matchBuildSnapshots.get(playerId)
    return snapshot ? structuredClone(snapshot) : null
  }

  /**
   * 权威结算钩子。调用方必须传入已由战斗服务确认的碎片，
   * Room 不会从 UI 或不完整快照猜测掉落。
   */
  async commitPlayerSettlement(input: {
    requestId: string
    matchId: string
    playerId: string
    reason: SettlementReason
    highestCompletedWave: number
    officialVictory: boolean
    retainedWeaponFragments: Readonly<Record<string, number>>
    stageSelection?: PveStageSelection
  }): Promise<MatchPlayerSettlement> {
    if (!this.accountRuntime) throw new Error('PLAYER_ACCOUNT_SERVICE_NOT_CONFIGURED')
    return this.accountRuntime.accountService.settleMatch({
      ...input,
    })
  }

  setPendingStageSelection(selection: PveStageSelection) {
    this.pendingStageSelection = structuredClone(selection)
  }

  consumePendingStageSelection() {
    const selection = this.pendingStageSelection
    this.pendingStageSelection = null
    return selection ? structuredClone(selection) : null
  }

  getActiveStageSelection(): PveStageSelection | null {
    return this.activeStageSelection ? structuredClone(this.activeStageSelection) : null
  }

  getStageSelectionForMatch(matchId: string): PveStageSelection | null {
    const selection = this.stageSelectionsByMatchId.get(matchId)
    return selection ? structuredClone(selection) : null
  }

  exportPveCheckpointPayload(): Record<string, unknown> {
    const state = this.engine.getStateSnapshot()
    if (!state.pve?.configSnapshot || state.status === 'waiting') throw new Error('PVE_CHECKPOINT_MATCH_NOT_RUNNING')
    return {
      schemaVersion: 1,
      roomId: this.id,
      phase: this.phase,
      hostPlayerId: this.hostPlayerId,
      slotAssignments: [...this.slotAssignments.entries()],
      pendingStageSelection: this.pendingStageSelection ? structuredClone(this.pendingStageSelection) : null,
      activeStageSelection: this.activeStageSelection ? structuredClone(this.activeStageSelection) : null,
      // Checkpoint carries only the salted hash credential so a restarted room can still
      // enforce its password. Never expose this payload through public room projections.
      passwordCredential: this.passwordCredential ? structuredClone(this.passwordCredential) : null,
      stageSelectionsByMatchId: [...this.stageSelectionsByMatchId.entries()].map(([matchId, selection]) => [matchId, structuredClone(selection)]),
      matchBuildSnapshots: [...this.matchBuildSnapshots.entries()].map(([playerId, snapshot]) => [playerId, structuredClone(snapshot)]),
      engine: this.engine.exportPveCheckpointPayload(),
    }
  }

  restorePveCheckpointPayload(raw: Record<string, unknown>): void {
    const checkpoint = structuredClone(raw) as {
      schemaVersion: number
      roomId: string
      phase: RoomPhase
      hostPlayerId: string | null
      slotAssignments: Array<[EngineSlotId, string]>
      pendingStageSelection: PveStageSelection | null
      activeStageSelection: PveStageSelection | null
      passwordCredential?: PasswordCredential | null
      stageSelectionsByMatchId: Array<[string, PveStageSelection]>
      matchBuildSnapshots: Array<[string, MatchBuildSnapshot]>
      engine: Record<string, unknown>
    }
    if (checkpoint.schemaVersion !== 1 || checkpoint.roomId !== this.id || checkpoint.phase !== 'playing') {
      throw new Error('PVE_ROOM_CHECKPOINT_INVALID')
    }
    if (this.countdownTimer) clearTimeout(this.countdownTimer)
    this.countdownTimer = null
    this.countdownPreparing = false
    this.phase = 'playing'
    this.hostPlayerId = checkpoint.hostPlayerId
    this.slotAssignments.clear()
    for (const [slot, playerId] of checkpoint.slotAssignments) this.slotAssignments.set(slot, playerId)
    this.pendingStageSelection = checkpoint.pendingStageSelection ? structuredClone(checkpoint.pendingStageSelection) : null
    this.activeStageSelection = checkpoint.activeStageSelection ? structuredClone(checkpoint.activeStageSelection) : null
    if (checkpoint.passwordCredential) {
      const credential = checkpoint.passwordCredential
      if (credential.algorithm !== 'scrypt' || credential.version !== 1
        || typeof credential.saltHex !== 'string' || typeof credential.hashHex !== 'string'
        || typeof credential.updatedAt !== 'string') throw new Error('PVE_ROOM_CHECKPOINT_PASSWORD_INVALID')
      this.passwordCredential = structuredClone(credential)
    } else {
      this.passwordCredential = null
    }
    this.stageSelectionsByMatchId.clear()
    for (const [matchId, selection] of checkpoint.stageSelectionsByMatchId) {
      this.stageSelectionsByMatchId.set(matchId, structuredClone(selection))
    }
    this.matchBuildSnapshots.clear()
    for (const [playerId, snapshot] of checkpoint.matchBuildSnapshots) {
      this.matchBuildSnapshots.set(playerId, structuredClone(snapshot))
    }
    this.engine.restorePveCheckpointPayload(checkpoint.engine)
  }

  destroy() {
    this.pendingStageSelection = null
    this.activeStageSelection = null
    this.stageSelectionsByMatchId.clear()
    this.countdownPreparing = false

    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer)
      this.countdownTimer = null
    }
  }

  private async lockMatchBuildSnapshots(): Promise<void> {
    if (!this.accountRuntime) {
      this.matchBuildSnapshots.clear()
      this.engine.setMatchBuildSnapshots({})
      return
    }
    const matchId = this.engine.getStateSnapshot().matchId
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const playerIds = this.getConnectedPlayerIds().sort()
      const snapshots = await Promise.all(playerIds.map(async (playerId) => {
        const account = await this.accountRuntime!.accountService.getOrCreate(playerId)
        return this.accountRuntime!.accountService.createBuildSnapshot({
          requestId: `lock-build:${matchId}:${playerId}`,
          matchId,
          playerId,
          expectedAccountVersion: account.version,
        }, this.accountRuntime!.buildResolver)
      }))
      const connectedAfterRead = this.getConnectedPlayerIds().sort()
      if (playerIds.length !== connectedAfterRead.length
        || playerIds.some((playerId, index) => playerId !== connectedAfterRead[index])) continue
      this.matchBuildSnapshots.clear()
      for (const snapshot of snapshots) this.matchBuildSnapshots.set(snapshot.playerId, snapshot)
      this.engine.setMatchBuildSnapshots(Object.fromEntries(
        snapshots.map(snapshot => [snapshot.playerId, snapshot]),
      ))
      return
    }
    throw new Error('CONNECTED_PLAYERS_CHANGED_DURING_BUILD_LOCK')
  }

  private syncEngineRoomRules() {
    const activeSlots = this.getActiveSlots()
    const playerSlotAssignments = ROOM_SLOT_ORDER.flatMap((slotId) => {
      const playerId = this.slotAssignments.get(slotId)
      return playerId ? [{ playerId, slotId }] : []
    })

    this.engine.syncPlayerSlots(playerSlotAssignments)
    this.engine.setActiveSlots(activeSlots)
    this.engine.setPlayerCount(this.getPlayerCount())
  }

  private getFirstAssignedPlayerId(): string | null {
    for (const slot of ROOM_SLOT_ORDER) {
      const playerId = this.slotAssignments.get(slot)
      if (playerId) {
        return playerId
      }
    }

    return null
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>()

  constructor(
    private readonly config: ServerConfig,
    private readonly accountRuntime?: RoomAccountRuntime,
  ) {}

  createRoom(roomId: string, options?: RoomCreateOptions) {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`)
    }

    const room = new Room(roomId, this.config, options, this.accountRuntime)
    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId) ?? null
  }

  getOrCreateRoom(roomId: string, options?: RoomCreateOptions) {
    return this.getRoom(roomId) ?? this.createRoom(roomId, options)
  }

  listRooms(options?: { includeEmpty?: boolean }) {
    const includeEmpty = options?.includeEmpty ?? true
    const rooms = [...this.rooms.values()]
    return includeEmpty ? rooms : rooms.filter((room) => !room.isEmpty())
  }

  removeRoom(roomId: string) {
    const room = this.rooms.get(roomId)
    room?.destroy()
    return this.rooms.delete(roomId)
  }

  removeEmptyRooms() {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.isEmpty()) {
        this.rooms.delete(roomId)
      }
    }
  }
}
