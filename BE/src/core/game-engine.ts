import { ActionQueue } from './action-queue'
import { Enemy } from './entities/enemy'
import { Tower } from './entities/tower'
import { GridMap } from './grid-map'
import type { BuildTowerAction, ClientAction, PlayerIdentity, QueuedAction } from '../domain/actions'
import type { GameLogEntry, GameState, PlayerState, Position, TowerState } from '../domain/game-state'
import type { ServerConfig } from '../config/server-config'
import { enemyCatalog } from '../domain/enemy-catalog'
import { towerCatalog } from '../domain/tower-catalog'
import { buildWaveSpawnSchedule, buildWaveTimeline, getWaveStateForTick, type ScheduledEnemySpawn, type WaveTimelineEntry, waveCatalog } from '../domain/wave-catalog'

type TickListener = (state: GameState) => void
type ActionListener = (action: QueuedAction) => void

export class GameEngine {
  private readonly config: ServerConfig

  private readonly actionQueue = new ActionQueue()

  private readonly tickListeners = new Set<TickListener>()

  private readonly actionListeners = new Set<ActionListener>()

  private readonly state: GameState

  private readonly gridMap: GridMap

  private enemies: Enemy[] = []

  private towers: Tower[] = []

  private readonly waveTimeline: WaveTimelineEntry[]

  private readonly spawnSchedule: ScheduledEnemySpawn[]

  private nextSpawnScheduleIndex = 0

  private shouldRecalculateEnemyPaths = false

  constructor(config: ServerConfig) {
    this.config = config

    const laneRow = Math.floor(config.mapHeight / 2)
    const spawn = { x: 0, y: laneRow }
    const base = { x: config.mapWidth - 1, y: laneRow }
    this.gridMap = GridMap.create(config.mapWidth, config.mapHeight, spawn, base)
    this.waveTimeline = buildWaveTimeline(waveCatalog)
    this.spawnSchedule = buildWaveSpawnSchedule(this.waveTimeline)

    this.state = {
      matchId: config.matchId,
      tick: 0,
      tickRateMs: config.tickRateMs,
      startedAt: Date.now(),
      map: {
        width: config.mapWidth,
        height: config.mapHeight,
        cells: this.gridMap.toCells(),
        spawn,
        base,
      },
      base: {
        x: base.x,
        y: base.y,
        hp: 20,
        maxHp: 20,
      },
      wave: getWaveStateForTick(0, this.waveTimeline, this.spawnSchedule, this.nextSpawnScheduleIndex),
      players: [],
      enemies: [],
      towers: [],
      pendingActions: 0,
      logs: [],
    }

    this.gridMap.setValidationOrigins([spawn])

    this.appendLog('info', 'GameEngine initialized', {
      tickRateMs: config.tickRateMs,
      mapWidth: config.mapWidth,
      mapHeight: config.mapHeight,
    })
  }

  registerPlayer(identity: PlayerIdentity) {
    const existingPlayer = this.state.players.find((player) => player.id === identity.playerId)

    if (existingPlayer) {
      existingPlayer.name = identity.playerName
      existingPlayer.kind = identity.playerKind
      existingPlayer.connectionStatus = 'connected'
      this.appendLog('info', 'Player reconnected', { playerId: identity.playerId, kind: identity.playerKind })
      return
    }

    const player: PlayerState = {
      id: identity.playerId,
      name: identity.playerName,
      kind: identity.playerKind,
      gold: this.config.playerStartingGold,
      score: 0,
      connectionStatus: 'connected',
      lastActionAt: null,
    }

    this.state.players.push(player)
    this.appendLog('info', 'Player registered', { playerId: player.id, kind: player.kind })
  }

  markPlayerDisconnected(playerId: string) {
    const player = this.state.players.find((item) => item.id === playerId)
    if (!player) {
      return
    }

    player.connectionStatus = 'disconnected'
    this.appendLog('warn', 'Player disconnected', { playerId })
  }

  enqueueAction(player: PlayerIdentity, action: ClientAction) {
    const queuedAction: QueuedAction = {
      id: `${player.playerId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      receivedAt: Date.now(),
      player,
      action,
    }

    this.actionQueue.enqueue(queuedAction)
    this.state.pendingActions = this.actionQueue.size()

    const actor = this.ensurePlayer(player)
    actor.lastActionAt = queuedAction.receivedAt

    const actionSnapshot = structuredClone(queuedAction)
    for (const listener of this.actionListeners) {
      listener(actionSnapshot)
    }

    this.appendLog('info', 'Action queued', {
      queueSize: this.actionQueue.size(),
      playerId: player.playerId,
      action: action.action,
    })
  }

  onTick(listener: TickListener) {
    this.tickListeners.add(listener)
    return () => {
      this.tickListeners.delete(listener)
    }
  }

  onActionQueued(listener: ActionListener) {
    this.actionListeners.add(listener)
    return () => {
      this.actionListeners.delete(listener)
    }
  }

  getStateSnapshot(): GameState {
    this.syncRuntimeState()
    return structuredClone(this.state)
  }

  tick() {
    this.state.tick += 1
    this.processQueuedActions()

    // 严格按 Tick 顺序执行：新塔建成后先重算活体敌人的路径，再结算塔攻击与移动。
    if (this.shouldRecalculateEnemyPaths) {
      this.recalculateEnemyPaths()
      this.shouldRecalculateEnemyPaths = false
    }

    this.resolveTowerAttacks()
    this.collectDefeatedEnemies()
    const reachedBaseEnemyIds = this.updateEnemyPositions(this.config.tickRateMs / 1000)
    this.resolveEnemiesAtBase(reachedBaseEnemyIds)
    this.spawnEnemiesForCurrentTick()
    this.updateWaveState()
    this.refreshRouteValidationOrigins()
    this.syncRuntimeState()
    this.state.pendingActions = this.actionQueue.size()

    this.appendLog('info', 'Tick settled', {
      tick: this.state.tick,
      players: this.state.players.length,
      towers: this.towers.length,
      enemies: this.enemies.length,
      pendingActions: this.state.pendingActions,
    })

    const snapshot = this.getStateSnapshot()
    for (const listener of this.tickListeners) {
      listener(snapshot)
    }
  }

  private processQueuedActions() {
    const queuedActions = this.actionQueue.drain()
    if (queuedActions.length === 0) {
      return
    }

    for (const queuedAction of queuedActions) {
      this.handleAction(queuedAction)
    }
  }

  private handleAction(queuedAction: QueuedAction) {
    switch (queuedAction.action.action) {
      case 'BUILD_TOWER':
        this.handleBuildTower(queuedAction as QueuedAction & { action: BuildTowerAction })
        return
      case 'UPGRADE_TOWER':
        this.appendLog('info', 'Upgrade action acknowledged but not implemented yet', {
          playerId: queuedAction.player.playerId,
          towerId: queuedAction.action.towerId,
        })
        return
      case 'SELL_TOWER':
        this.appendLog('info', 'Sell action acknowledged but not implemented yet', {
          playerId: queuedAction.player.playerId,
          towerId: queuedAction.action.towerId,
        })
        return
    }
  }

  private handleBuildTower(queuedAction: QueuedAction & { action: BuildTowerAction }) {
    const player = this.ensurePlayer(queuedAction.player)
    const { x, y, type } = queuedAction.action
    const stats = towerCatalog[type]

    if (!stats) {
      this.appendLog('warn', 'Unknown tower type rejected', { playerId: player.id, type })
      return
    }

    if (!this.isValidBuildCoordinate(x, y)) {
      this.appendLog('warn', 'Build rejected because coordinates are invalid', { playerId: player.id, x, y })
      return
    }

    this.refreshRouteValidationOrigins()
    if (!this.gridMap.canBuildTower(x, y)) {
      this.appendLog('warn', 'Build rejected because tower would block the route to base', {
        playerId: player.id,
        x,
        y,
      })
      return
    }

    if (player.gold < stats.cost) {
      this.appendLog('warn', 'Build rejected because player has insufficient gold', {
        playerId: player.id,
        gold: player.gold,
        requiredGold: stats.cost,
      })
      return
    }

    player.gold -= stats.cost

    const tower: TowerState = {
      id: `tower-${this.state.tick}-${this.towers.length + 1}`,
      ownerId: player.id,
      type,
      x,
      y,
      damage: stats.damage,
      range: stats.range,
      fireRateTicks: stats.fireRateTicks,
      cooldownTicks: 0,
      targetingStrategy: stats.targetingStrategy,
    }

    this.towers.push(new Tower(tower))
    this.gridMap.occupy(x, y)
    this.syncMapCells()
    this.shouldRecalculateEnemyPaths = true
    this.appendLog('info', 'Tower built', { playerId: player.id, towerId: tower.id, type, x, y })
  }

  private spawnEnemiesForCurrentTick() {
    let spawnedAtLeastOneEnemy = false

    while (this.nextSpawnScheduleIndex < this.spawnSchedule.length) {
      const scheduledSpawn = this.spawnSchedule[this.nextSpawnScheduleIndex]
      if (scheduledSpawn.dueTick > this.state.tick) {
        break
      }

      this.nextSpawnScheduleIndex += 1
      if (this.spawnEnemy(scheduledSpawn)) {
        spawnedAtLeastOneEnemy = true
      }
    }

    if (spawnedAtLeastOneEnemy) {
      this.refreshRouteValidationOrigins()
    }
  }

  private resolveTowerAttacks() {
    for (const tower of this.towers) {
      const target = tower.fire(this.enemies)
      if (!target) {
        continue
      }

      this.appendLog('info', 'Tower fired', { towerId: tower.id, enemyId: target.id, damage: tower.damage })
    }
  }

  private collectDefeatedEnemies() {
    const defeatedEnemies = this.enemies.filter((enemy) => !enemy.isAlive())
    if (defeatedEnemies.length === 0) {
      return
    }

    const defeatedEnemyIds = new Set(defeatedEnemies.map((enemy) => enemy.id))
    this.enemies = this.enemies.filter((enemy) => !defeatedEnemyIds.has(enemy.id))

    for (const enemy of defeatedEnemies) {
      const owner = this.findRewardOwner(enemy)
      if (owner) {
        owner.gold += enemy.rewardGold
        owner.score += enemy.rewardGold
      }

      this.appendLog('info', 'Enemy defeated', { enemyId: enemy.id, rewardGold: enemy.rewardGold })
    }

    this.refreshRouteValidationOrigins()
  }

  private updateEnemyPositions(deltaTime: number) {
    const reachedBaseEnemyIds = new Set<string>()

    for (const enemy of this.enemies) {
      enemy.move(deltaTime, (reachedEnemy) => {
        reachedBaseEnemyIds.add(reachedEnemy.id)
      })
    }

    return reachedBaseEnemyIds
  }

  private resolveEnemiesAtBase(reachedBaseEnemyIds: Set<string>) {
    if (reachedBaseEnemyIds.size === 0) {
      return
    }

    const survivors: Enemy[] = []
    for (const enemy of this.enemies) {
      if (!reachedBaseEnemyIds.has(enemy.id)) {
        survivors.push(enemy)
        continue
      }

      this.state.base.hp = Math.max(0, this.state.base.hp - enemy.baseDamage)
      this.appendLog('warn', 'Enemy reached the base', {
        enemyId: enemy.id,
        baseDamage: enemy.baseDamage,
        remainingBaseHp: this.state.base.hp,
      })
    }

    this.enemies = survivors
  }

  private ensurePlayer(identity: PlayerIdentity) {
    let player = this.state.players.find((item) => item.id === identity.playerId)
    if (!player) {
      this.registerPlayer(identity)
      player = this.state.players.find((item) => item.id === identity.playerId)
    }

    if (!player) {
      throw new Error(`Player ${identity.playerId} could not be registered`)
    }

    return player
  }

  private isValidBuildCoordinate(x: number, y: number) {
    const cell = this.gridMap.getCell(x, y)
    return cell !== null && cell.buildable && cell.walkable
  }

  private appendLog(level: GameLogEntry['level'], message: string, meta?: Record<string, unknown>) {
    const entry: GameLogEntry = {
      tick: this.state.tick,
      level,
      message,
      meta,
    }

    this.state.logs.push(entry)
    if (this.state.logs.length > 200) {
      this.state.logs.shift()
    }
  }

  private refreshRouteValidationOrigins() {
    const origins: Position[] = [this.state.map.spawn]

    for (const enemy of this.enemies) {
      const anchor = enemy.getGridAnchor()
      origins.push({ x: anchor.x, y: anchor.y })
    }

    this.gridMap.setValidationOrigins(origins)
  }

  private recalculateEnemyPaths() {
    for (const enemy of this.enemies) {
      const start = enemy.getGridAnchor()
      const path = this.gridMap.findPath(start.x, start.y, this.gridMap.BASE_POINT.x, this.gridMap.BASE_POINT.y)
      const pathFound = enemy.recalculatePath(enemy.x, enemy.y, path, this.gridMap.BASE_POINT)
      if (!pathFound) {
        this.appendLog('warn', 'Enemy cannot find a recalculated path and will hold position', { enemyId: enemy.id })
      }
    }
  }

  private syncMapCells() {
    this.state.map.cells = this.gridMap.toCells()
  }

  private updateWaveState() {
    this.state.wave = getWaveStateForTick(
      this.state.tick,
      this.waveTimeline,
      this.spawnSchedule,
      this.nextSpawnScheduleIndex,
    )
  }

  private spawnEnemy(scheduledSpawn: ScheduledEnemySpawn) {
    const enemyConfig = enemyCatalog[scheduledSpawn.kind]
    if (!enemyConfig) {
      this.appendLog('warn', 'Enemy spawn skipped because kind is unknown', {
        kind: scheduledSpawn.kind,
        waveIndex: scheduledSpawn.waveIndex,
      })
      return false
    }

    const path = this.gridMap.findPath(this.state.map.spawn, this.state.map.base)
    if (path === null) {
      this.appendLog('error', 'Enemy spawn skipped because no path exists to base', {
        tick: this.state.tick,
        kind: scheduledSpawn.kind,
        waveIndex: scheduledSpawn.waveIndex,
      })
      return false
    }

    const enemy = new Enemy({
      id: `enemy-${scheduledSpawn.kind}-${this.state.tick}-${this.enemies.length + 1}`,
      kind: enemyConfig.kind,
      x: this.state.map.spawn.x,
      y: this.state.map.spawn.y,
      hp: enemyConfig.maxHp,
      maxHp: enemyConfig.maxHp,
      speed: enemyConfig.speed,
      rewardGold: enemyConfig.rewardGold,
      baseDamage: enemyConfig.baseDamage,
      path,
      pathIndex: 0,
      lastDamagedByPlayerId: null,
    })

    enemy.recalculatePath(this.state.map.spawn.x, this.state.map.spawn.y, path, this.gridMap.BASE_POINT)
    this.enemies.push(enemy)
    this.appendLog('info', 'Enemy spawned', {
      enemyId: enemy.id,
      kind: enemy.kind,
      waveIndex: scheduledSpawn.waveIndex,
      waveLabel: scheduledSpawn.waveLabel,
      x: enemy.x,
      y: enemy.y,
    })
    return true
  }

  private findRewardOwner(enemy: Enemy) {
    if (enemy.lastDamagedByPlayerId) {
      const lastAttacker = this.state.players.find((player) => player.id === enemy.lastDamagedByPlayerId)
      if (lastAttacker) {
        return lastAttacker
      }
    }

    return this.state.players[0]
  }

  private syncRuntimeState() {
    this.state.enemies = this.enemies.map((enemy) => enemy.toState())
    this.state.towers = this.towers.map((tower) => tower.toState())
  }
}