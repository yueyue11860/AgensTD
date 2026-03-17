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
import type { WaveConfig } from '../../../shared/contracts/game'

export type RoomPhase = 'lobby' | 'countdown' | 'waiting_for_level' | 'playing'

export const ROOM_SLOT_ORDER = ['P1', 'P2', 'P3', 'P4'] as const satisfies readonly EngineSlotId[]

export interface RoomCreateOptions {
  displayName?: string
  hasPassword?: boolean
}

export interface RoomSlotSnapshot {
  slotId: EngineSlotId
  playerId: string | null
  playerName: string | null
  connected: boolean
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

  private readonly hasPassword: boolean

  // 第一个加入的玩家为房主
  private hostPlayerId: string | null = null

  // 倒计时定时器句柄（idle 时务必清除）
  private countdownTimer: NodeJS.Timeout | null = null

  constructor(id: string, config: ServerConfig, options?: RoomCreateOptions) {
    this.id = id
    this.displayName = options?.displayName?.trim() || id
    this.hasPassword = options?.hasPassword ?? false
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

  joinPlayer(playerId: string) {
    const existingSlot = this.getPlayerSlot(playerId)
    if (existingSlot) {
      return existingSlot
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
    return this.phase
  }

  getHostPlayerId(): string | null {
    return this.hostPlayerId
  }

  /** 返回当前房间内全部玩家 ID 列表 */
  getConnectedPlayerIds(): string[] {
    return [...this.slotAssignments.values()]
  }

  getSummary(): RoomSummarySnapshot {
    const players = this.engine.getStateSnapshot().players

    return {
      id: this.id,
      name: this.displayName,
      hasPassword: this.hasPassword,
      players: this.slotAssignments.size,
      maxPlayers: ROOM_SLOT_ORDER.length,
      phase: this.phase,
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
  beginCountdown(
    requestorPlayerId: string,
    onComplete: () => void,
  ): 'ok' | 'wrong_phase' | 'forbidden' {
    if (this.phase !== 'lobby') {
      return 'wrong_phase'
    }

    if (requestorPlayerId !== this.hostPlayerId) {
      return 'forbidden'
    }

    this.phase = 'countdown'
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null
      this.phase = 'waiting_for_level'
      onComplete()
    }, 3000)

    return 'ok'
  }

  /**
   * 校验通过后点火引擎：加载关卡波次配置并启动刷怪。
   * 应由 SocketGateway 在所有校验通过后调用。
   */
  igniteWithLevel(waves: WaveConfig[], startingGold?: number): void {
    this.phase = 'playing'
    this.engine.ignite(waves, startingGold)
  }

  destroy() {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer)
      this.countdownTimer = null
    }
  }

  private syncEngineRoomRules() {
    const activeSlots = this.getActiveSlots()
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

  constructor(private readonly config: ServerConfig) {}

  createRoom(roomId: string, options?: RoomCreateOptions) {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`)
    }

    const room = new Room(roomId, this.config, options)
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