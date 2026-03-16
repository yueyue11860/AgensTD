import type { ServerConfig } from '../config/server-config'
import {
  ARENA_GRID_SIZE,
  WAYPOINTS_MAP,
  createArenaMapCells,
  getArenaLoopStartIndex,
  getArenaPrimaryBasePoint,
} from '../config/arena-layout'
import type { Position } from '../domain/game-state'
import type { GridMapCell } from './grid-map'
import { GameEngine, type EngineLaneRoute, type EngineSlotId } from './game-engine'

export const ROOM_SLOT_ORDER = ['P1', 'P2', 'P3', 'P4'] as const satisfies readonly EngineSlotId[]

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

function clonePath(path: readonly Position[]) {
  return path.map((position) => ({ x: position.x, y: position.y }))
}

function createLaneRoutes(): Record<EngineSlotId, EngineLaneRoute> {
  return {
    P1: {
      slot: 'P1',
      spawn: { ...WAYPOINTS_MAP.P1[0] },
      path: clonePath(WAYPOINTS_MAP.P1),
      loopStartIndex: getArenaLoopStartIndex(WAYPOINTS_MAP.P1),
    },
    P2: {
      slot: 'P2',
      spawn: { ...WAYPOINTS_MAP.P2[0] },
      path: clonePath(WAYPOINTS_MAP.P2),
      loopStartIndex: getArenaLoopStartIndex(WAYPOINTS_MAP.P2),
    },
    P3: {
      slot: 'P3',
      spawn: { ...WAYPOINTS_MAP.P3[0] },
      path: clonePath(WAYPOINTS_MAP.P3),
      loopStartIndex: getArenaLoopStartIndex(WAYPOINTS_MAP.P3),
    },
    P4: {
      slot: 'P4',
      spawn: { ...WAYPOINTS_MAP.P4[0] },
      path: clonePath(WAYPOINTS_MAP.P4),
      loopStartIndex: getArenaLoopStartIndex(WAYPOINTS_MAP.P4),
    },
  }
}

export function createFixedRoomLayout(width: number, height: number): RoomLayout {
  if (width < MIN_ROOM_WIDTH || height < MIN_ROOM_HEIGHT) {
    throw new Error(`Arena room requires at least ${MIN_ROOM_WIDTH}x${MIN_ROOM_HEIGHT} cells`)
  }

  const laneRoutes = createLaneRoutes()
  const cells: GridMapCell[][] = createArenaMapCells(width, height)

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

  constructor(id: string, config: ServerConfig) {
    this.id = id
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
    this.syncEngineRoomRules()
    return openSlot
  }

  leavePlayer(playerId: string) {
    const slot = this.getPlayerSlot(playerId)
    if (!slot) {
      return false
    }

    this.slotAssignments.delete(slot)
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

  private syncEngineRoomRules() {
    const activeSlots = this.getActiveSlots()
    this.engine.setActiveSlots(activeSlots)
    this.engine.setPlayerCount(this.getPlayerCount())
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>()

  constructor(private readonly config: ServerConfig) {}

  createRoom(roomId: string) {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`)
    }

    const room = new Room(roomId, this.config)
    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId) ?? null
  }

  getOrCreateRoom(roomId: string) {
    return this.getRoom(roomId) ?? this.createRoom(roomId)
  }

  listRooms() {
    return [...this.rooms.values()]
  }

  removeRoom(roomId: string) {
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