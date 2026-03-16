import type { Position } from '../domain/game-state'

export type GridMapCellKind = 'gate' | 'core' | 'build' | 'blocked'

export interface GridMapCell extends Position {
  kind: GridMapCellKind
  walkable: boolean
  buildable: boolean
  label?: string
}

interface SearchNode extends Position {
  g: number
  h: number
  f: number
}

function toKey(x: number, y: number) {
  return `${x},${y}`
}

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y }
}

export class GridMap {
  readonly width: number

  readonly height: number

  readonly spawn: Position

  readonly base: Position

  private readonly cells: GridMapCell[][]

  private validationOrigins: Position[]

  constructor(cells: GridMapCell[][], spawn: Position, base: Position) {
    if (cells.length === 0 || cells[0]?.length === 0) {
      throw new Error('GridMap requires a non-empty 2D cell matrix')
    }

    this.height = cells.length
    this.width = cells[0].length
    this.cells = cells.map((row) => row.map((cell) => ({ ...cell })))
    this.spawn = clonePosition(spawn)
    this.base = clonePosition(base)
    this.validationOrigins = [clonePosition(spawn)]
  }

  static create(width: number, height: number, spawn: Position, base: Position, blocked: Position[] = []) {
    const blockedKeys = new Set(blocked.map((position) => toKey(position.x, position.y)))
    const rows: GridMapCell[][] = []

    for (let y = 0; y < height; y += 1) {
      const row: GridMapCell[] = []
      for (let x = 0; x < width; x += 1) {
        const key = toKey(x, y)
        const isSpawn = x === spawn.x && y === spawn.y
        const isBase = x === base.x && y === base.y
        const isBlocked = blockedKeys.has(key)

        if (isSpawn) {
          row.push({ x, y, kind: 'gate', walkable: true, buildable: false, label: '入口' })
          continue
        }

        if (isBase) {
          row.push({ x, y, kind: 'core', walkable: true, buildable: false, label: '基地' })
          continue
        }

        if (isBlocked) {
          row.push({ x, y, kind: 'blocked', walkable: false, buildable: false })
          continue
        }

        row.push({ x, y, kind: 'build', walkable: true, buildable: true })
      }

      rows.push(row)
    }

    return new GridMap(rows, spawn, base)
  }

  setValidationOrigins(origins: Position[]) {
    const uniqueOrigins = new Map<string, Position>()

    for (const origin of origins) {
      if (!this.isInside(origin.x, origin.y)) {
        continue
      }

      uniqueOrigins.set(toKey(origin.x, origin.y), clonePosition(origin))
    }

    if (uniqueOrigins.size === 0) {
      uniqueOrigins.set(toKey(this.spawn.x, this.spawn.y), clonePosition(this.spawn))
    }

    this.validationOrigins = [...uniqueOrigins.values()]
  }

  isInside(x: number, y: number) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  getCell(x: number, y: number) {
    if (!this.isInside(x, y)) {
      return null
    }

    return this.cells[y][x]
  }

  isWalkable(x: number, y: number, blockedKeys?: Set<string>) {
    const cell = this.getCell(x, y)
    if (!cell) {
      return false
    }

    if (blockedKeys?.has(toKey(x, y))) {
      return false
    }

    return cell.walkable
  }

  occupy(x: number, y: number) {
    const cell = this.getCell(x, y)
    if (!cell || cell.kind === 'gate' || cell.kind === 'core') {
      return
    }

    cell.kind = 'blocked'
    cell.walkable = false
    cell.buildable = false
  }

  release(x: number, y: number) {
    const cell = this.getCell(x, y)
    if (!cell || cell.kind === 'gate' || cell.kind === 'core') {
      return
    }

    cell.kind = 'build'
    cell.walkable = true
    cell.buildable = true
  }

  toCells() {
    return this.cells.flat().map((cell) => ({ ...cell }))
  }

  canBuildTower(x: number, y: number) {
    const cell = this.getCell(x, y)
    if (!cell || !cell.buildable || !cell.walkable) {
      return false
    }

    const blockedKeys = new Set<string>([toKey(x, y)])
    for (const origin of this.validationOrigins) {
      const path = this.findPath(origin, this.base, blockedKeys)
      if (path.length === 0) {
        return false
      }
    }

    return true
  }

  findPath(start: Position, goal: Position, blockedKeys?: Set<string>): Position[] {
    if (!this.isInside(start.x, start.y) || !this.isInside(goal.x, goal.y)) {
      return []
    }

    if (!this.isWalkable(start.x, start.y, blockedKeys) || !this.isWalkable(goal.x, goal.y, blockedKeys)) {
      return []
    }

    if (start.x === goal.x && start.y === goal.y) {
      return [clonePosition(start)]
    }

    const startKey = toKey(start.x, start.y)
    const goalKey = toKey(goal.x, goal.y)
    const open: SearchNode[] = [{
      x: start.x,
      y: start.y,
      g: 0,
      h: this.heuristic(start, goal),
      f: this.heuristic(start, goal),
    }]
    const openKeys = new Set<string>([startKey])
    const closedKeys = new Set<string>()
    const cameFrom = new Map<string, string>()
    const gScores = new Map<string, number>([[startKey, 0]])

    while (open.length > 0) {
      let winnerIndex = 0
      for (let index = 1; index < open.length; index += 1) {
        if (open[index].f < open[winnerIndex].f || (open[index].f === open[winnerIndex].f && open[index].h < open[winnerIndex].h)) {
          winnerIndex = index
        }
      }

      const current = open.splice(winnerIndex, 1)[0]
      const currentKey = toKey(current.x, current.y)
      openKeys.delete(currentKey)

      if (currentKey === goalKey) {
        return this.reconstructPath(cameFrom, currentKey)
      }

      closedKeys.add(currentKey)

      for (const neighbor of this.getNeighbors(current)) {
        const neighborKey = toKey(neighbor.x, neighbor.y)
        if (closedKeys.has(neighborKey) || !this.isWalkable(neighbor.x, neighbor.y, blockedKeys)) {
          continue
        }

        const tentativeG = (gScores.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1
        if (tentativeG >= (gScores.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
          continue
        }

        cameFrom.set(neighborKey, currentKey)
        gScores.set(neighborKey, tentativeG)

        const h = this.heuristic(neighbor, goal)
        const nextNode: SearchNode = {
          x: neighbor.x,
          y: neighbor.y,
          g: tentativeG,
          h,
          f: tentativeG + h,
        }

        if (!openKeys.has(neighborKey)) {
          open.push(nextNode)
          openKeys.add(neighborKey)
          continue
        }

        const existingIndex = open.findIndex((node) => node.x === neighbor.x && node.y === neighbor.y)
        if (existingIndex >= 0) {
          open[existingIndex] = nextNode
        }
      }
    }

    return []
  }

  private heuristic(from: Position, to: Position) {
    return Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
  }

  private getNeighbors(position: Position): Position[] {
    const offsets = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]

    return offsets
      .map((offset) => ({ x: position.x + offset.x, y: position.y + offset.y }))
      .filter((neighbor) => this.isInside(neighbor.x, neighbor.y))
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
}