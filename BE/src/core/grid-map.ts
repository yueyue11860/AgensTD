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

const DIRECTIONS: ReadonlyArray<Position> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

function toKey(x: number, y: number) {
  return `${x},${y}`
}

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y }
}

class MinHeap<T> {
  private readonly items: T[] = []

  constructor(private readonly compare: (left: T, right: T) => number) {}

  push(value: T) {
    this.items.push(value)
    this.bubbleUp(this.items.length - 1)
  }

  pop() {
    if (this.items.length === 0) {
      return null
    }

    const first = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0 && last) {
      this.items[0] = last
      this.bubbleDown(0)
    }

    return first
  }

  get size() {
    return this.items.length
  }

  private bubbleUp(startIndex: number) {
    let index = startIndex

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.compare(this.items[index], this.items[parentIndex]) >= 0) {
        return
      }

      ;[this.items[index], this.items[parentIndex]] = [this.items[parentIndex], this.items[index]]
      index = parentIndex
    }
  }

  private bubbleDown(startIndex: number) {
    let index = startIndex

    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      let nextIndex = index

      if (leftIndex < this.items.length && this.compare(this.items[leftIndex], this.items[nextIndex]) < 0) {
        nextIndex = leftIndex
      }

      if (rightIndex < this.items.length && this.compare(this.items[rightIndex], this.items[nextIndex]) < 0) {
        nextIndex = rightIndex
      }

      if (nextIndex === index) {
        return
      }

      ;[this.items[index], this.items[nextIndex]] = [this.items[nextIndex], this.items[index]]
      index = nextIndex
    }
  }
}

export class GridMap {
  readonly width: number

  readonly height: number

  readonly SPAWN_POINT: Position

  readonly BASE_POINT: Position

  readonly spawn: Position

  readonly base: Position

  private readonly grid: number[][]

  private validationOrigins: Position[]

  /*
   * GridMap 在无头 Node.js 引擎里只做纯内存计算：
   * - grid[y][x] = 0 表示可通行
   * - grid[y][x] = 1 表示障碍物或已建造防御塔
   * - SPAWN_POINT / BASE_POINT 永远保持可通行
   */
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

    this.grid = this.normalizeGrid(cellsOrGrid)
    this.grid[this.SPAWN_POINT.y][this.SPAWN_POINT.x] = 0
    this.grid[this.BASE_POINT.y][this.BASE_POINT.x] = 0
    this.validationOrigins = [clonePosition(spawn)]
  }

  static create(width: number, height: number, spawn: Position, base: Position, blocked: Position[] = []) {
    const blockedKeys = new Set(blocked.map((position) => toKey(position.x, position.y)))
    const grid: number[][] = []

    for (let y = 0; y < height; y += 1) {
      const row: number[] = []
      for (let x = 0; x < width; x += 1) {
        const isSpecial = (x === spawn.x && y === spawn.y) || (x === base.x && y === base.y)
        row.push(!isSpecial && blockedKeys.has(toKey(x, y)) ? 1 : 0)
      }

      grid.push(row)
    }

    return new GridMap(grid, spawn, base)
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
      uniqueOrigins.set(toKey(this.SPAWN_POINT.x, this.SPAWN_POINT.y), clonePosition(this.SPAWN_POINT))
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

    return this.createCellView(x, y)
  }

  isWalkable(x: number, y: number, blockedKeys?: Set<string>) {
    if (!this.isInside(x, y)) {
      return false
    }

    if (blockedKeys?.has(toKey(x, y))) {
      return false
    }

    return this.grid[y][x] === 0
  }

  occupy(x: number, y: number, width = 1, height = 1) {
    for (const position of this.getFootprintPositions(x, y, width, height)) {
      if (!this.isInside(position.x, position.y) || this.isSpecialPoint(position.x, position.y)) {
        continue
      }

      this.grid[position.y][position.x] = 1
    }
  }

  release(x: number, y: number, width = 1, height = 1) {
    for (const position of this.getFootprintPositions(x, y, width, height)) {
      if (!this.isInside(position.x, position.y) || this.isSpecialPoint(position.x, position.y)) {
        continue
      }

      this.grid[position.y][position.x] = 0
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

    const footprint = this.getFootprintPositions(x, y, width, height)

    // 先做最便宜的非法性判断，避免无意义地触发寻路。
    for (const position of footprint) {
      if (!this.isInside(position.x, position.y) || this.isSpecialPoint(position.x, position.y) || this.grid[position.y][position.x] === 1) {
        return false
      }
    }

    const blockedKeys = new Set(footprint.map((position) => toKey(position.x, position.y)))

    // 严格的“死胡同拦截”逻辑：
    // 先虚拟落塔，再立即做连通性测试，只要任意关键起点无法到达基地，就拒绝建塔。
    for (const origin of this.getValidationOrigins()) {
      const path = this.findPathInternal(origin.x, origin.y, this.BASE_POINT.x, this.BASE_POINT.y, blockedKeys)
      if (path === null) {
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

  private heuristic(from: Position, to: Position) {
    return Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
  }

  private findPathInternal(startX: number, startY: number, endX: number, endY: number, blockedKeys?: Set<string>) {
    // 起点、终点不合法，或者已经不可通行时，明确返回 null。
    if (!this.isInside(startX, startY) || !this.isInside(endX, endY)) {
      return null
    }

    if (!this.isWalkable(startX, startY, blockedKeys) || !this.isWalkable(endX, endY, blockedKeys)) {
      return null
    }

    if (startX === endX && startY === endY) {
      return [{ x: startX, y: startY }]
    }

    const goal = { x: endX, y: endY }
    const startKey = toKey(startX, startY)
    const goalKey = toKey(endX, endY)
    const cameFrom = new Map<string, string>()
    const gScores = new Map<string, number>([[startKey, 0]])
    const closedKeys = new Set<string>()
    const openHeap = new MinHeap<SearchNode>((left, right) => {
      if (left.f !== right.f) {
        return left.f - right.f
      }

      if (left.h !== right.h) {
        return left.h - right.h
      }

      return left.g - right.g
    })
    const startH = this.heuristic({ x: startX, y: startY }, goal)

    openHeap.push({ x: startX, y: startY, g: 0, h: startH, f: startH })

    // A* 使用曼哈顿距离作为启发函数，适用于四方向网格，且不会高估剩余代价。
    while (openHeap.size > 0) {
      const current = openHeap.pop()
      if (!current) {
        break
      }

      const currentKey = toKey(current.x, current.y)
      if (closedKeys.has(currentKey)) {
        continue
      }

      if (currentKey === goalKey) {
        return this.reconstructPath(cameFrom, currentKey)
      }

      closedKeys.add(currentKey)

      for (const neighbor of this.getNeighbors(current.x, current.y)) {
        const neighborKey = toKey(neighbor.x, neighbor.y)
        if (closedKeys.has(neighborKey) || !this.isWalkable(neighbor.x, neighbor.y, blockedKeys)) {
          continue
        }

        // 四方向移动时，每一步代价恒定为 1。
        const tentativeG = current.g + 1
        const knownG = gScores.get(neighborKey)
        if (knownG !== undefined && tentativeG >= knownG) {
          continue
        }

        const h = this.heuristic(neighbor, goal)
        cameFrom.set(neighborKey, currentKey)
        gScores.set(neighborKey, tentativeG)
        openHeap.push({
          x: neighbor.x,
          y: neighbor.y,
          g: tentativeG,
          h,
          f: tentativeG + h,
        })
      }
    }

    return null
  }

  private getNeighbors(x: number, y: number): Position[] {
    const neighbors: Position[] = []

    for (const direction of DIRECTIONS) {
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

  private normalizeGrid(cellsOrGrid: GridMapCell[][] | number[][]) {
    return cellsOrGrid.map((row, y) => row.map((cellOrValue, x) => {
      if (typeof cellOrValue === 'number') {
        return cellOrValue === 1 ? 1 : 0
      }

      const isSpawn = x === this.SPAWN_POINT.x && y === this.SPAWN_POINT.y
      const isBase = x === this.BASE_POINT.x && y === this.BASE_POINT.y
      if (isSpawn || isBase) {
        return 0
      }

      return cellOrValue.walkable ? 0 : 1
    }))
  }

  private createCellView(x: number, y: number): GridMapCell {
    // 对外仍然暴露结构化 Cell，方便现有状态同步与前端展示复用。
    if (x === this.SPAWN_POINT.x && y === this.SPAWN_POINT.y) {
      return { x, y, kind: 'gate', walkable: true, buildable: false, label: '入口' }
    }

    if (x === this.BASE_POINT.x && y === this.BASE_POINT.y) {
      return { x, y, kind: 'core', walkable: true, buildable: false, label: '基地' }
    }

    if (this.grid[y][x] === 1) {
      return { x, y, kind: 'blocked', walkable: false, buildable: false }
    }

    return { x, y, kind: 'build', walkable: true, buildable: true }
  }

  private getValidationOrigins() {
    const uniqueOrigins = new Map<string, Position>()
    uniqueOrigins.set(toKey(this.SPAWN_POINT.x, this.SPAWN_POINT.y), clonePosition(this.SPAWN_POINT))

    for (const origin of this.validationOrigins) {
      if (!this.isInside(origin.x, origin.y)) {
        continue
      }

      uniqueOrigins.set(toKey(origin.x, origin.y), clonePosition(origin))
    }

    return [...uniqueOrigins.values()]
  }

  private isSpecialPoint(x: number, y: number) {
    return (x === this.SPAWN_POINT.x && y === this.SPAWN_POINT.y)
      || (x === this.BASE_POINT.x && y === this.BASE_POINT.y)
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
}