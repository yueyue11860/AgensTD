import type { GridMapCell } from '../core/grid-map'
import type { Position } from '../domain/game-state'

export type ArenaSlotId = 'P1' | 'P2' | 'P3' | 'P4'

export const ARENA_GRID_SIZE = 29

const ARENA_CORE_CENTER: Position = { x: 14, y: 14 }
const ARENA_CORE_RADIUS = 1

export const LOOP_REENTRY_OFFSET = 6

export const WAYPOINTS_MAP: Record<ArenaSlotId, Position[]> = {
  P1: [
    { x: 13, y: 15 },
    { x: 13, y: 18 },
    { x: 7, y: 18 },
    { x: 7, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 14 },
    { x: 3, y: 14 },
    { x: 3, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 14 },
  ],
  P2: [
    { x: 15, y: 15 },
    { x: 18, y: 15 },
    { x: 18, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 21 },
    { x: 14, y: 21 },
    { x: 14, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 25 },
    { x: 14, y: 25 },
  ],
  P3: [
    { x: 15, y: 13 },
    { x: 15, y: 10 },
    { x: 21, y: 10 },
    { x: 21, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 14 },
    { x: 25, y: 14 },
    { x: 25, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 14 },
  ],
  P4: [
    { x: 13, y: 13 },
    { x: 10, y: 13 },
    { x: 10, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 21 },
    { x: 21, y: 21 },
    { x: 21, y: 7 },
    { x: 14, y: 7 },
    { x: 14, y: 3 },
    { x: 25, y: 3 },
    { x: 25, y: 25 },
    { x: 3, y: 25 },
    { x: 3, y: 3 },
    { x: 14, y: 3 },
  ],
}

const ARENA_SLOT_ORDER: readonly ArenaSlotId[] = ['P1', 'P2', 'P3', 'P4']

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y }
}

function clonePath(path: readonly Position[]) {
  return path.map(clonePosition)
}

function isArenaCoreCell(x: number, y: number) {
  return Math.abs(x - ARENA_CORE_CENTER.x) <= ARENA_CORE_RADIUS && Math.abs(y - ARENA_CORE_CENTER.y) <= ARENA_CORE_RADIUS
}

function positionKey(x: number, y: number) {
  return `${x},${y}`
}

function getLinePositions(start: Position, end: Position) {
  const positions: Position[] = []

  if (start.x !== end.x && start.y !== end.y) {
    throw new Error(`Arena waypoint segments must be axis-aligned: (${start.x}, ${start.y}) -> (${end.x}, ${end.y})`)
  }

  if (start.x === end.x) {
    const step = start.y <= end.y ? 1 : -1
    for (let y = start.y; y !== end.y + step; y += step) {
      positions.push({ x: start.x, y })
    }
    return positions
  }

  const step = start.x <= end.x ? 1 : -1
  for (let x = start.x; x !== end.x + step; x += step) {
    positions.push({ x, y: start.y })
  }

  return positions
}

export function getArenaLoopStartIndex(path: readonly Position[]) {
  if (path.length === 0) {
    return 0
  }

  return Math.max(0, path.length - LOOP_REENTRY_OFFSET)
}

function appendHubApproach(path: Position[], hub: Position) {
  const nextPath = clonePath(path)
  const last = nextPath[nextPath.length - 1]

  if (!last) {
    return [clonePosition(hub)]
  }

  if (last.x !== hub.x) {
    nextPath.push({ x: hub.x, y: last.y })
  }

  if (nextPath[nextPath.length - 1].y !== hub.y) {
    nextPath.push({ x: hub.x, y: hub.y })
  }

  return nextPath
}

export function createArenaEnemyLanePath(slot: ArenaSlotId): Position[] {
  return clonePath(WAYPOINTS_MAP[slot])
}

export function getArenaLaneSpawnPoint(slot: ArenaSlotId): Position {
  return clonePosition(WAYPOINTS_MAP[slot][0])
}

export function getArenaPrimarySpawnPoint(): Position {
  return getArenaLaneSpawnPoint('P1')
}

export function getArenaPrimaryBasePoint(): Position {
  return clonePosition(ARENA_CORE_CENTER)
}

export function createArenaGridMatrix(width: number, height: number) {
  if (width < ARENA_GRID_SIZE || height < ARENA_GRID_SIZE) {
    throw new Error(`Arena grid requires at least ${ARENA_GRID_SIZE}x${ARENA_GRID_SIZE} cells`)
  }

  const grid = Array.from({ length: height }, () => Array<number>(width).fill(1))

  for (const slot of ARENA_SLOT_ORDER) {
    const path = WAYPOINTS_MAP[slot]
    for (let index = 0; index < path.length - 1; index += 1) {
      const start = path[index]
      const end = path[index + 1]

      for (const position of getLinePositions(start, end)) {
        if (position.x < 0 || position.y < 0 || position.x >= width || position.y >= height) {
          throw new Error(`Arena waypoint is outside of the grid: (${position.x}, ${position.y})`)
        }

        grid[position.y][position.x] = 0
      }
    }
  }

  return grid
}

export function createArenaMapCells(width: number, height: number): GridMapCell[][] {
  const grid = createArenaGridMatrix(width, height)
  const gateByKey = new Map<string, string>()

  for (const slot of ARENA_SLOT_ORDER) {
    const spawn = getArenaLaneSpawnPoint(slot)
    gateByKey.set(positionKey(spawn.x, spawn.y), slot.toLowerCase())
  }

  return grid.map((row, y) => row.map((value, x) => {
    const gateLabel = gateByKey.get(positionKey(x, y))
    const isCore = isArenaCoreCell(x, y)

    let kind: GridMapCell['kind'] = 'build'
    let label: string | undefined

    if (gateLabel) {
      kind = 'gate'
      label = gateLabel
    }
    else if (isCore) {
      kind = 'core'
    }
    else if (value === 0) {
      kind = 'path'
    }

    return {
      x,
      y,
      kind,
      walkable: kind === 'gate' || kind === 'core' || kind === 'path',
      buildable: kind === 'build',
      label,
    }
  }))
}