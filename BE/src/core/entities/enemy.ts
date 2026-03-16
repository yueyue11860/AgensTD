import type { EnemyKind, EnemyState, Position } from '../../domain/game-state'

const POSITION_EPSILON = 0.0001

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y }
}

function isSamePosition(left: Position, right: Position) {
  return Math.abs(left.x - right.x) <= POSITION_EPSILON && Math.abs(left.y - right.y) <= POSITION_EPSILON
}

export class Enemy {
  readonly id: string

  readonly kind: EnemyKind

  readonly maxHp: number

  readonly speed: number

  readonly rewardGold: number

  readonly baseDamage: number

  x: number

  y: number

  hp: number

  currentPath: Position[]

  pathIndex: number

  lastDamagedByPlayerId: string | null

  private reachedBase = false

  private basePoint: Position | null

  constructor(state: EnemyState) {
    this.id = state.id
    this.kind = state.kind
    this.x = state.x
    this.y = state.y
    this.hp = state.hp
    this.maxHp = state.maxHp
    this.speed = state.speed
    this.rewardGold = state.rewardGold
    this.baseDamage = state.baseDamage
    this.currentPath = state.path.map(clonePosition)
    this.pathIndex = state.pathIndex
    this.lastDamagedByPlayerId = state.lastDamagedByPlayerId
    this.basePoint = state.path.length > 0 ? clonePosition(state.path[state.path.length - 1]) : null
  }

  receiveDamage(amount: number, sourcePlayerId: string) {
    this.hp = Math.max(0, this.hp - amount)
    this.lastDamagedByPlayerId = sourcePlayerId
  }

  recalculatePath(currentX: number, currentY: number, nextPath: Position[] | null, basePoint: Position) {
    this.x = currentX
    this.y = currentY
    this.reachedBase = false
    this.basePoint = clonePosition(basePoint)

    if (nextPath === null) {
      this.currentPath = [{ x: currentX, y: currentY }]
      this.pathIndex = 0
      return false
    }

    const rebuiltPath: Position[] = [{ x: currentX, y: currentY }]

    // 第一段从敌人当前的浮点坐标出发，后续节点沿用 A* 生成的网格路径。
    for (const waypoint of nextPath.slice(1)) {
      const lastWaypoint = rebuiltPath[rebuiltPath.length - 1]
      if (!isSamePosition(lastWaypoint, waypoint)) {
        rebuiltPath.push(clonePosition(waypoint))
      }
    }

    const lastWaypoint = rebuiltPath[rebuiltPath.length - 1]
    if (!isSamePosition(lastWaypoint, basePoint)) {
      rebuiltPath.push(clonePosition(basePoint))
    }

    this.currentPath = rebuiltPath
    this.pathIndex = 0
    return true
  }

  move(deltaTime: number, onReachedBase?: (enemy: Enemy) => void) {
    if (this.reachedBase || deltaTime <= 0 || this.currentPath.length === 0) {
      return this.reachedBase
    }

    let remainingDistance = this.speed * deltaTime

    while (remainingDistance > 0 && this.pathIndex < this.currentPath.length - 1) {
      const target = this.currentPath[this.pathIndex + 1]
      const deltaX = target.x - this.x
      const deltaY = target.y - this.y
      const distanceToTarget = Math.hypot(deltaX, deltaY)

      if (distanceToTarget <= POSITION_EPSILON) {
        this.x = target.x
        this.y = target.y
        this.pathIndex += 1
        continue
      }

      if (remainingDistance >= distanceToTarget) {
        this.x = target.x
        this.y = target.y
        this.pathIndex += 1
        remainingDistance -= distanceToTarget
        continue
      }

      const travelRatio = remainingDistance / distanceToTarget
      this.x += deltaX * travelRatio
      this.y += deltaY * travelRatio
      remainingDistance = 0
    }

    if (
      !this.reachedBase
      && this.basePoint
      && isSamePosition({ x: this.x, y: this.y }, this.basePoint)
      && this.pathIndex >= this.currentPath.length - 1
    ) {
      this.reachedBase = true
      onReachedBase?.(this)
    }

    return this.reachedBase
  }

  isAlive() {
    return this.hp > 0
  }

  getGridAnchor() {
    return {
      x: Math.round(this.x),
      y: Math.round(this.y),
    }
  }

  getRemainingPathDistance() {
    return Math.max(0, this.currentPath.length - this.pathIndex - 1)
  }

  toState(): EnemyState {
    return {
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      hp: this.hp,
      maxHp: this.maxHp,
      speed: this.speed,
      rewardGold: this.rewardGold,
      baseDamage: this.baseDamage,
      path: this.currentPath.map(clonePosition),
      pathIndex: this.pathIndex,
      lastDamagedByPlayerId: this.lastDamagedByPlayerId,
    }
  }
}