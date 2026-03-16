import type {
  DamageType,
  EnemyKind,
  EnemyState,
  EnemyStatusEffectState,
  EnemyTraitState,
  Position,
} from '../../domain/game-state'

const POSITION_EPSILON = 0.0001

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y }
}

function isSamePosition(left: Position, right: Position) {
  return Math.abs(left.x - right.x) <= POSITION_EPSILON && Math.abs(left.y - right.y) <= POSITION_EPSILON
}

export interface EnemyDeathSplitRequest {
  kind: EnemyKind
  count: number
}

export class Enemy {
  readonly id: string

  readonly kind: EnemyKind

  readonly maxHp: number

  readonly baseSpeed: number

  readonly baseArmor: number

  readonly maxShield: number

  readonly rewardGold: number

  readonly baseDamage: number

  x: number

  y: number

  hp: number

  shield: number

  currentPath: Position[]

  pathIndex: number

  lastDamagedByPlayerId: string | null

  activeEffects: EnemyStatusEffectState[]

  traits: EnemyTraitState[]

  private reachedBase = false

  private basePoint: Position | null

  private deathSplitConsumed = false

  constructor(state: EnemyState) {
    this.id = state.id
    this.kind = state.kind
    this.x = state.x
    this.y = state.y
    this.hp = state.hp
    this.maxHp = state.maxHp
    this.shield = state.shield ?? 0
    this.maxShield = state.maxShield ?? 0
    this.baseSpeed = state.baseSpeed ?? state.speed
    this.baseArmor = state.baseArmor ?? state.baseDefense ?? state.armor ?? state.defense ?? 0
    this.rewardGold = state.rewardGold
    this.baseDamage = state.baseDamage
    this.currentPath = state.path.map(clonePosition)
    this.pathIndex = state.pathIndex
    this.lastDamagedByPlayerId = state.lastDamagedByPlayerId
    this.activeEffects = state.activeEffects.map((effect) => ({ ...effect }))
    this.traits = (state.traits ?? []).map((trait) => ({ ...trait }))
    this.basePoint = state.path.length > 0 ? clonePosition(state.path[state.path.length - 1]) : null
  }

  get speed() {
    return this.getEffectiveSpeed()
  }

  get armor() {
    return this.getEffectiveArmor()
  }

  get defense() {
    // 兼容旧代码路径。
    return this.armor
  }

  receiveDamage(amount: number, sourcePlayerId: string | null, ignoresDefense = false) {
    return this.takeDamage(amount, ignoresDefense ? 'true' : 'physical', sourcePlayerId, ignoresDefense)
  }

  takeDamage(amount: number, type: DamageType, sourcePlayerId: string | null = null, ignoresArmor = false) {
    if (!this.isAlive() || amount <= 0) {
      return 0
    }

    let remainingDamage = amount
    let totalAppliedDamage = 0

    if (this.shield > 0) {
      const absorbedByShield = Math.min(this.shield, remainingDamage)
      this.shield -= absorbedByShield
      remainingDamage -= absorbedByShield
      totalAppliedDamage += absorbedByShield
    }

    if (remainingDamage > 0) {
      const bypassArmor = ignoresArmor || type === 'true'
      const hpDamage = bypassArmor ? remainingDamage : Math.max(1, remainingDamage - this.armor)
      this.hp = Math.max(0, this.hp - hpDamage)
      totalAppliedDamage += hpDamage
    }

    if (sourcePlayerId) {
      this.lastDamagedByPlayerId = sourcePlayerId
    }

    return totalAppliedDamage
  }

  addEffect(effect: EnemyStatusEffectState) {
    const existingEffectIndex = this.activeEffects.findIndex((activeEffect) => activeEffect.kind === effect.kind)

    if (existingEffectIndex < 0) {
      this.activeEffects.push({ ...effect })
      return
    }

    const existingEffect = this.activeEffects[existingEffectIndex]
    this.activeEffects[existingEffectIndex] = {
      ...existingEffect,
      ...effect,
      remainingDurationMs: this.mergeDuration(existingEffect.remainingDurationMs, effect.remainingDurationMs),
      speedMultiplier: this.mergeSpeedMultiplier(existingEffect.speedMultiplier, effect.speedMultiplier),
      defenseModifier: this.mergeDefenseModifier(existingEffect.defenseModifier, effect.defenseModifier),
      damagePerSecond: Math.max(existingEffect.damagePerSecond ?? 0, effect.damagePerSecond ?? 0) || undefined,
      maxHpDamagePerSecondRatio: Math.max(
        existingEffect.maxHpDamagePerSecondRatio ?? 0,
        effect.maxHpDamagePerSecondRatio ?? 0,
      ) || undefined,
    }
  }

  updateEffects(deltaTime: number) {
    if (deltaTime <= 0 || !this.isAlive()) {
      return
    }

    const deltaMs = deltaTime * 1000
    this.updateTraits(deltaMs)

    if (this.activeEffects.length === 0) {
      return
    }

    const nextEffects: EnemyStatusEffectState[] = []

    for (const effect of this.activeEffects) {
      const activeDurationMs = effect.remainingDurationMs === null
        ? deltaMs
        : Math.min(deltaMs, Math.max(0, effect.remainingDurationMs))

      if (effect.damagePerSecond && effect.damagePerSecond > 0 && activeDurationMs > 0) {
        this.receiveDamage(
          effect.damagePerSecond * (activeDurationMs / 1000),
          effect.sourcePlayerId,
          effect.ignoresDefense ?? false,
        )
      }

      if (effect.maxHpDamagePerSecondRatio && effect.maxHpDamagePerSecondRatio > 0 && activeDurationMs > 0) {
        this.receiveDamage(
          this.maxHp * effect.maxHpDamagePerSecondRatio * (activeDurationMs / 1000),
          effect.sourcePlayerId,
          effect.ignoresDefense ?? false,
        )
      }

      if (effect.remainingDurationMs === null) {
        nextEffects.push({ ...effect })
        continue
      }

      const nextDurationMs = effect.remainingDurationMs - deltaMs
      if (nextDurationMs > 0) {
        nextEffects.push({
          ...effect,
          remainingDurationMs: nextDurationMs,
        })
      }
    }

    this.activeEffects = nextEffects
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
      shield: this.shield,
      maxShield: this.maxShield,
      baseSpeed: this.baseSpeed,
      speed: this.speed,
      baseArmor: this.baseArmor,
      armor: this.armor,
      baseDefense: this.baseArmor,
      defense: this.defense,
      rewardGold: this.rewardGold,
      baseDamage: this.baseDamage,
      path: this.currentPath.map(clonePosition),
      pathIndex: this.pathIndex,
      lastDamagedByPlayerId: this.lastDamagedByPlayerId,
      activeEffects: this.activeEffects.map((effect) => ({ ...effect })),
      traits: this.traits.map((trait) => ({ ...trait })),
    }
  }

  collectSplitOnDeathSpawns(): EnemyDeathSplitRequest[] {
    if (this.isAlive() || this.deathSplitConsumed) {
      return []
    }

    const splitRequests: EnemyDeathSplitRequest[] = []
    for (const trait of this.traits) {
      if (trait.kind !== 'split-on-death') {
        continue
      }

      if (trait.spawnCount > 0) {
        splitRequests.push({
          kind: trait.spawnKind,
          count: trait.spawnCount,
        })
      }
    }

    this.deathSplitConsumed = true
    return splitRequests
  }

  private getEffectiveSpeed() {
    let multiplier = 1

    for (const effect of this.activeEffects) {
      if (effect.speedMultiplier === undefined) {
        continue
      }

      multiplier *= Math.max(0, effect.speedMultiplier)
    }

    return Math.max(0, this.baseSpeed * multiplier)
  }

  private getEffectiveArmor() {
    let modifier = 0

    for (const effect of this.activeEffects) {
      modifier += effect.defenseModifier ?? 0
    }

    return Math.max(0, this.baseArmor + modifier)
  }

  private updateTraits(deltaMs: number) {
    if (this.traits.length === 0 || deltaMs <= 0) {
      return
    }

    const nextTraits: EnemyTraitState[] = []
    for (const trait of this.traits) {
      if (trait.kind !== 'cleanse') {
        nextTraits.push(trait)
        continue
      }

      let remainingCooldownMs = trait.remainingCooldownMs - deltaMs
      while (remainingCooldownMs <= 0) {
        this.activeEffects = []
        remainingCooldownMs += trait.intervalMs
      }

      nextTraits.push({
        ...trait,
        remainingCooldownMs,
      })
    }

    this.traits = nextTraits
  }

  private mergeDuration(currentDurationMs: number | null, nextDurationMs: number | null) {
    if (currentDurationMs === null || nextDurationMs === null) {
      return null
    }

    return Math.max(currentDurationMs, nextDurationMs)
  }

  private mergeSpeedMultiplier(currentMultiplier?: number, nextMultiplier?: number) {
    if (currentMultiplier === undefined) {
      return nextMultiplier
    }

    if (nextMultiplier === undefined) {
      return currentMultiplier
    }

    return Math.min(currentMultiplier, nextMultiplier)
  }

  private mergeDefenseModifier(currentModifier?: number, nextModifier?: number) {
    return Math.min(currentModifier ?? 0, nextModifier ?? 0)
  }
}