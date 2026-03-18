import type { Position } from '../domain/game-state'

export type GridMapCellKind = 'gate' | 'core' | 'path' | 'build' | 'blocked'

export interface GridMapCell extends Position {
  kind: GridMapCellKind
  walkable: boolean
  buildable: boolean
  label?: string
}

interface TerrainCell {
  kind: GridMapCellKind
  label?: string
}

const WALKABLE_CELL_KINDS = new Set<GridMapCellKind>(['gate', 'core', 'path'])

function toKey(x: number, y: number) {
  return `${x},${y}`
}

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y }
}

function cloneTerrainCell(cell: TerrainCell): TerrainCell {
  return {
    kind: cell.kind,
    label: cell.label,
  }
}

export class GridMap {
  readonly width: number

  readonly height: number

  readonly SPAWN_POINT: Position

  readonly BASE_POINT: Position

  readonly spawn: Position

  readonly base: Position

  private readonly terrain: TerrainCell[][]

  private readonly occupiedKeys = new Set<string>()

  constructor(cellsOrGrid: GridMapCell[][] | number[][], spawn: Position, base: Position) {
    if (cellsOrGrid.length === 0 || cellsOrGrid[0]?.length === 0) {
      throw new Error('GridMap requires a non-empty 2D grid matrix')
    }

    this.height = cellsOrGrid.length
    this.width = cellsOrGrid[0].length
    this.SPAWN_POINT = clonePosition(spawn)
    this.BASE_POINT = clonePosition(base)
    this.spawn = this.SPAWN_POINT
    this.base = this.BASE_POINT

    if (!this.isInside(this.SPAWN_POINT.x, this.SPAWN_POINT.y) || !this.isInside(this.BASE_POINT.x, this.BASE_POINT.y)) {
      throw new Error('Spawn point and base point must be inside the grid')
    }

    this.terrain = this.normalizeTerrain(cellsOrGrid)
    this.terrain[this.SPAWN_POINT.y][this.SPAWN_POINT.x] = { kind: 'gate', label: '入口' }
    this.terrain[this.BASE_POINT.y][this.BASE_POINT.x] = { kind: 'core', label: '环形核心' }
  }

  static create(width: number, height: number, spawn: Position, base: Position, blocked: Position[] = []) {
    const blockedKeys = new Set(blocked.map((position) => toKey(position.x, position.y)))
    const cells: GridMapCell[][] = []

    for (let y = 0; y < height; y += 1) {
      const row: GridMapCell[] = []
      for (let x = 0; x < width; x += 1) {
        const key = toKey(x, y)
        const isSpawn = x === spawn.x && y === spawn.y
        const isBase = x === base.x && y === base.y
        const isPath = GridMap.isStraightLinePath(spawn, base, x, y)

        let kind: GridMapCellKind = 'build'
        if (blockedKeys.has(key)) {
          kind = 'blocked'
        }
        else if (isSpawn) {
          kind = 'gate'
        }
        else if (isBase) {
          kind = 'core'
        }
        else if (isPath) {
          kind = 'path'
        }

        row.push({
          x,
          y,
          kind,
          walkable: WALKABLE_CELL_KINDS.has(kind),
          buildable: kind === 'build',
        })
      }

      cells.push(row)
    }

    return new GridMap(cells, spawn, base)
  }

  setValidationOrigins(_origins: Position[]) {
    // 固定轨道下，建塔合法性不再依赖动态连通性校验。
  }

  isInside(x: number, y: number) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  getCell(x: number, y: number) {
    if (!this.isInside(x, y)) {
      return null
    }

    return this.createCellView(x, y)
  }

  isWalkable(x: number, y: number, blockedKeys?: Set<string>) {
    if (!this.isInside(x, y)) {
      return false
    }

    if (blockedKeys?.has(toKey(x, y))) {
      return false
    }

    return WALKABLE_CELL_KINDS.has(this.terrain[y][x].kind)
  }

  occupy(x: number, y: number, width = 1, height = 1) {
    for (const position of this.getFootprintPositions(x, y, width, height)) {
      if (!this.isInside(position.x, position.y)) {
        continue
      }

      if (this.terrain[position.y][position.x].kind !== 'build') {
        continue
      }

      this.occupiedKeys.add(toKey(position.x, position.y))
    }
  }

  release(x: number, y: number, width = 1, height = 1) {
    for (const position of this.getFootprintPositions(x, y, width, height)) {
      this.occupiedKeys.delete(toKey(position.x, position.y))
    }
  }

  toCells() {
    const cells: GridMapCell[] = []

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        cells.push(this.createCellView(x, y))
      }
    }

    return cells
  }

  canBuildTower(x: number, y: number, width = 1, height = 1) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      return false
    }

    for (const position of this.getFootprintPositions(x, y, width, height)) {
      const cell = this.getCell(position.x, position.y)
      if (!cell || !cell.buildable) {
        return false
      }
    }

    return true
  }

  findPath(startX: number, startY: number, endX: number, endY: number): Position[] | null

  findPath(start: Position, goal: Position): Position[] | null

  findPath(startOrX: Position | number, startYOrGoal: Position | number, endX?: number, endY?: number) {
    if (typeof startOrX === 'number' && typeof startYOrGoal === 'number' && typeof endX === 'number' && typeof endY === 'number') {
      return this.findPathInternal(startOrX, startYOrGoal, endX, endY)
    }

    if (typeof startOrX === 'object' && typeof startYOrGoal === 'object') {
      return this.findPathInternal(startOrX.x, startOrX.y, startYOrGoal.x, startYOrGoal.y)
    }

    throw new Error('findPath expects either coordinates or start/goal positions')
  }

  private findPathInternal(startX: number, startY: number, endX: number, endY: number, blockedKeys?: Set<string>) {
    if (!this.isInside(startX, startY) || !this.isInside(endX, endY)) {
      return null
    }

    if (!this.isWalkable(startX, startY, blockedKeys) || !this.isWalkable(endX, endY, blockedKeys)) {
      return null
    }

    const startKey = toKey(startX, startY)
    const goalKey = toKey(endX, endY)
    const queue: Position[] = [{ x: startX, y: startY }]
    const visited = new Set<string>([startKey])
    const cameFrom = new Map<string, string>()

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) {
        break
      }

      const currentKey = toKey(current.x, current.y)
      if (currentKey === goalKey) {
        return this.reconstructPath(cameFrom, currentKey)
      }

      for (const neighbor of this.getNeighbors(current.x, current.y)) {
        const neighborKey = toKey(neighbor.x, neighbor.y)
        if (visited.has(neighborKey) || !this.isWalkable(neighbor.x, neighbor.y, blockedKeys)) {
          continue
        }

        visited.add(neighborKey)
        cameFrom.set(neighborKey, currentKey)
        queue.push(neighbor)
      }
    }

    return null
  }

  private getNeighbors(x: number, y: number): Position[] {
    const neighbors: Position[] = []

    const directions: ReadonlyArray<Position> = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]

    for (const direction of directions) {
      const nextX = x + direction.x
      const nextY = y + direction.y
      if (this.isInside(nextX, nextY)) {
        neighbors.push({ x: nextX, y: nextY })
      }
    }

    return neighbors
  }

  private reconstructPath(cameFrom: Map<string, string>, currentKey: string) {
    const path: Position[] = []
    let cursor: string | undefined = currentKey

    while (cursor) {
      const [x, y] = cursor.split(',').map(Number)
      path.push({ x, y })
      cursor = cameFrom.get(cursor)
    }

    path.reverse()
    return path
  }

  private normalizeTerrain(cellsOrGrid: GridMapCell[][] | number[][]) {
    return cellsOrGrid.map((row) => row.map((cellOrValue) => {
      if (typeof cellOrValue === 'number') {
        return {
          kind: cellOrValue === 0 ? 'path' : 'build',
        } satisfies TerrainCell
      }

      return cloneTerrainCell({
        kind: cellOrValue.kind,
        label: cellOrValue.label,
      })
    }))
  }

  private createCellView(x: number, y: number): GridMapCell {
    const terrainCell = this.terrain[y][x]
    const occupied = this.occupiedKeys.has(toKey(x, y))
    const walkable = WALKABLE_CELL_KINDS.has(terrainCell.kind)
    const buildable = terrainCell.kind === 'build' && !occupied

    return {
      x,
      y,
      kind: terrainCell.kind,
      walkable,
      buildable,
      label: terrainCell.label,
    }
  }

  private getFootprintPositions(x: number, y: number, width: number, height: number) {
    const positions: Position[] = []

    for (let offsetY = 0; offsetY < height; offsetY += 1) {
      for (let offsetX = 0; offsetX < width; offsetX += 1) {
        positions.push({
          x: x + offsetX,
          y: y + offsetY,
        })
      }
    }

    return positions
  }

  private static isStraightLinePath(spawn: Position, base: Position, x: number, y: number) {
    if (spawn.x === base.x && x === spawn.x) {
      return y >= Math.min(spawn.y, base.y) && y <= Math.max(spawn.y, base.y)
    }

    if (spawn.y === base.y && y === spawn.y) {
      return x >= Math.min(spawn.x, base.x) && x <= Math.max(spawn.x, base.x)
    }

    return false
  }
}