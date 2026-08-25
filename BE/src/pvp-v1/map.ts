import { createHash } from 'node:crypto'
import type {
  PvpGridPosition,
  PvpMapCell,
  PvpMapDefinition,
  PvpSide,
  PvpSideMapDefinition,
} from '../../../shared/contracts/pvp'

export const PVP_DUAL_REALM_MAP_ID = 'pvp_dual_realm_v1'
export const PVP_DUAL_REALM_MAP_VERSION = 1
export const PVP_GRID_SIZE = 29
export const PVP_NEUTRAL_BOUNDARY_Y = 14
export const PVP_ENEMY_BODY_RADIUS_MILLI = 406

export const PVP_A_ROUTE_ANCHORS: readonly PvpGridPosition[] = [
  { x: 14, y: 1 },
  { x: 14, y: 3 },
  { x: 4, y: 3 },
  { x: 4, y: 11 },
  { x: 24, y: 11 },
  { x: 24, y: 5 },
  { x: 9, y: 5 },
  { x: 9, y: 9 },
  { x: 19, y: 9 },
  { x: 19, y: 7 },
  { x: 14, y: 7 },
  { x: 14, y: 12 },
]

export function mirrorPvpPosition(position: PvpGridPosition): PvpGridPosition {
  return { x: position.x, y: PVP_GRID_SIZE - 1 - position.y }
}

export const PVP_B_ROUTE_ANCHORS: readonly PvpGridPosition[] = PVP_A_ROUTE_ANCHORS.map(mirrorPvpPosition)

function positionKey(position: PvpGridPosition): string {
  return `${position.x},${position.y}`
}

function rangeInclusive(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function rectangleCells(minX: number, maxX: number, minY: number, maxY: number): PvpGridPosition[] {
  return rangeInclusive(minY, maxY).flatMap((y) => rangeInclusive(minX, maxX).map((x) => ({ x, y })))
}

export function expandAxisAlignedRoute(anchors: readonly PvpGridPosition[]): PvpGridPosition[] {
  if (anchors.length < 2) throw new Error('PVP_ROUTE_REQUIRES_AT_LEAST_TWO_ANCHORS')
  const result: PvpGridPosition[] = []

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index]!
    const end = anchors[index + 1]!
    if (start.x !== end.x && start.y !== end.y) {
      throw new Error(`PVP_ROUTE_SEGMENT_NOT_AXIS_ALIGNED:${index}`)
    }
    const dx = Math.sign(end.x - start.x)
    const dy = Math.sign(end.y - start.y)
    let x = start.x
    let y = start.y
    while (true) {
      if (result.length === 0 || result[result.length - 1]!.x !== x || result[result.length - 1]!.y !== y) {
        result.push({ x, y })
      }
      if (x === end.x && y === end.y) break
      x += dx
      y += dy
    }
  }

  return result
}

function compileSide(side: PvpSide, routeAnchors: readonly PvpGridPosition[]): PvpSideMapDefinition {
  const ownMinY = side === 'A' ? 0 : 15
  const ownMaxY = side === 'A' ? 13 : 28
  const spawnGateCells = side === 'A'
    ? rectangleCells(13, 15, 0, 2)
    : rectangleCells(13, 15, 26, 28)
  const coreCells = side === 'A'
    ? rectangleCells(13, 15, 11, 13)
    : rectangleCells(13, 15, 15, 17)
  const routeCells = expandAxisAlignedRoute(routeAnchors)
  const excluded = new Set([
    ...spawnGateCells.map(positionKey),
    ...coreCells.map(positionKey),
    ...routeCells.map(positionKey),
  ])
  const deployableCells = rectangleCells(0, 28, ownMinY, ownMaxY)
    .filter((position) => !excluded.has(positionKey(position)))

  return {
    side,
    spawnGateCells,
    coreCells,
    routeAnchors: routeAnchors.map(({ x, y }) => ({ x, y })),
    routeCells,
    deployableCells,
  }
}

function createRouteHash(sides: Record<PvpSide, PvpSideMapDefinition>): string {
  const payload = (['A', 'B'] as const).map((side) => ({
    side,
    route: sides[side].routeCells.map(({ x, y }) => [x, y]),
    deployable: sides[side].deployableCells.map(({ x, y }) => [x, y]),
  }))
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function compileDualRealmMap(): PvpMapDefinition {
  const sides: Record<PvpSide, PvpSideMapDefinition> = {
    A: compileSide('A', PVP_A_ROUTE_ANCHORS),
    B: compileSide('B', PVP_B_ROUTE_ANCHORS),
  }
  const pathByKey = new Map<string, PvpSide>()
  const spawnByKey = new Map<string, PvpSide>()
  const coreByKey = new Map<string, PvpSide>()
  const deployableByKey = new Map<string, PvpSide>()
  for (const side of ['A', 'B'] as const) {
    for (const position of sides[side].routeCells) pathByKey.set(positionKey(position), side)
    for (const position of sides[side].spawnGateCells) spawnByKey.set(positionKey(position), side)
    for (const position of sides[side].coreCells) coreByKey.set(positionKey(position), side)
    for (const position of sides[side].deployableCells) deployableByKey.set(positionKey(position), side)
  }

  const cells: PvpMapCell[] = rectangleCells(0, 28, 0, 28).map((position) => {
    const key = positionKey(position)
    const spawnSide = spawnByKey.get(key)
    const coreSide = coreByKey.get(key)
    const pathSide = pathByKey.get(key)
    const deployableSide = deployableByKey.get(key)
    if (position.y === PVP_NEUTRAL_BOUNDARY_Y) {
      return { ...position, kind: 'neutral_boundary', ownerSide: null, deployable: false, walkable: false }
    }
    if (spawnSide) {
      return { ...position, kind: 'spawn_gate', ownerSide: spawnSide, deployable: false, walkable: true }
    }
    if (coreSide) {
      return { ...position, kind: 'core', ownerSide: coreSide, deployable: false, walkable: true }
    }
    if (pathSide) {
      return { ...position, kind: 'path', ownerSide: pathSide, deployable: false, walkable: true }
    }
    if (!deployableSide) throw new Error(`PVP_MAP_CELL_UNCLASSIFIED:${key}`)
    return { ...position, kind: 'deployable', ownerSide: deployableSide, deployable: true, walkable: false }
  })

  return {
    mapId: PVP_DUAL_REALM_MAP_ID,
    mapVersion: PVP_DUAL_REALM_MAP_VERSION,
    width: PVP_GRID_SIZE,
    height: PVP_GRID_SIZE,
    neutralBoundaryY: PVP_NEUTRAL_BOUNDARY_Y,
    routeHash: createRouteHash(sides),
    cells,
    sides,
  }
}

export const DUAL_REALM_MAP = compileDualRealmMap()

export function isPvpDeployableCell(side: PvpSide, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false
  return DUAL_REALM_MAP.sides[side].deployableCells.some((cell) => cell.x === x && cell.y === y)
}

export function hasEnemyBodyFullyExitedPvpSpawnGate(
  side: PvpSide,
  xMilli: number,
  yMilli: number,
  radiusMilli = PVP_ENEMY_BODY_RADIUS_MILLI,
): boolean {
  const minXMilli = 12_500
  const maxXMilli = 15_500
  const minYMilli = side === 'A' ? -500 : 25_500
  const maxYMilli = side === 'A' ? 2_500 : 28_500
  return xMilli + radiusMilli < minXMilli
    || xMilli - radiusMilli > maxXMilli
    || yMilli + radiusMilli < minYMilli
    || yMilli - radiusMilli > maxYMilli
}
