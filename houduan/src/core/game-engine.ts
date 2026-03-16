import { ActionQueue } from './action-queue'
import { GridMap } from './grid-map'
import type { BuildTowerAction, ClientAction, PlayerIdentity, QueuedAction } from '../domain/actions'
import type { EnemyState, GameLogEntry, GameState, PlayerState, Position, TowerState } from '../domain/game-state'
import type { ServerConfig } from '../config/server-config'
import { towerCatalog } from '../domain/tower-catalog'

type TickListener = (state: GameState) => void
type ActionListener = (action: QueuedAction) => void

export class GameEngine {
  private readonly config: ServerConfig

  private readonly actionQueue = new ActionQueue()

  private readonly tickListeners = new Set<TickListener>()

  private readonly actionListeners = new Set<ActionListener>()

  private readonly state: GameState

  private readonly gridMap: GridMap

  private lastEnemySpawnTick = -10

  constructor(config: ServerConfig) {
    this.config = config

    const laneRow = Math.floor(config.mapHeight / 2)
    const spawn = { x: 0, y: laneRow }
    const base = { x: config.mapWidth - 1, y: laneRow }
    this.gridMap = GridMap.create(config.mapWidth, config.mapHeight, spawn, base)

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
    return structuredClone(this.state)
  }

  tick() {
    this.state.tick += 1
    this.processQueuedActions()
    this.resolveTowerAttacks()
    this.collectDefeatedEnemies()
    this.updateEnemyPositions()
    this.resolveEnemiesAtBase()
    this.spawnEnemyIfNeeded()
    this.state.pendingActions = this.actionQueue.size()

    this.appendLog('info', 'Tick settled', {
      tick: this.state.tick,
      players: this.state.players.length,
      towers: this.state.towers.length,
      enemies: this.state.enemies.length,
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
      id: `tower-${this.state.tick}-${this.state.towers.length + 1}`,
      ownerId: player.id,
      type,
      x,
      y,
      damage: stats.damage,
      range: stats.range,
      fireRateTicks: stats.fireRateTicks,
      cooldownTicks: 0,
    }

    this.state.towers.push(tower)
    this.gridMap.occupy(x, y)
    this.syncMapCells()
    this.recalculateEnemyPaths()
    this.refreshRouteValidationOrigins()
    this.appendLog('info', 'Tower built', { playerId: player.id, towerId: tower.id, type, x, y })
  }

  private spawnEnemyIfNeeded() {
    if (this.state.tick - this.lastEnemySpawnTick < 10) {
      return
    }

    this.lastEnemySpawnTick = this.state.tick
    const path = this.gridMap.findPath(this.state.map.spawn, this.state.map.base)
    if (path.length === 0) {
      this.appendLog('error', 'Enemy spawn skipped because no path exists to base', {
        tick: this.state.tick,
      })
      return
    }

    const enemy: EnemyState = {
      id: `enemy-${this.state.tick}`,
      kind: 'runner',
      x: this.state.map.spawn.x,
      y: this.state.map.spawn.y,
      hp: 100,
      maxHp: 100,
      speed: 1,
      rewardGold: 15,
      baseDamage: 1,
      path,
      pathIndex: 0,
      lastDamagedByPlayerId: null,
    }

    this.state.enemies.push(enemy)
    this.refreshRouteValidationOrigins()
    this.appendLog('info', 'Enemy spawned', { enemyId: enemy.id, x: enemy.x, y: enemy.y })
  }

  private resolveTowerAttacks() {
    for (const tower of this.state.towers) {
      if (tower.cooldownTicks > 0) {
        tower.cooldownTicks -= 1
        continue
      }

      const target = this.findNearestEnemyInRange(tower)
      if (!target) {
        continue
      }

      target.hp = Math.max(0, target.hp - tower.damage)
      target.lastDamagedByPlayerId = tower.ownerId
      tower.cooldownTicks = tower.fireRateTicks
      this.appendLog('info', 'Tower fired', { towerId: tower.id, enemyId: target.id, damage: tower.damage })
    }
  }

  private collectDefeatedEnemies() {
    const defeatedEnemies = this.state.enemies.filter((enemy) => enemy.hp <= 0)
    if (defeatedEnemies.length === 0) {
      return
    }

    this.state.enemies = this.state.enemies.filter((enemy) => enemy.hp > 0)
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

  private updateEnemyPositions() {
    this.state.enemies = this.state.enemies.map((enemy) => {
      const nextPath = this.gridMap.findPath({ x: enemy.x, y: enemy.y }, this.state.map.base)
      if (nextPath.length === 0) {
        this.appendLog('warn', 'Enemy cannot find a route to base and will hold position', { enemyId: enemy.id })
        return {
          ...enemy,
          path: [{ x: enemy.x, y: enemy.y }],
          pathIndex: 0,
        }
      }

      const movementSteps = Math.max(1, Math.floor(enemy.speed))
      const nextIndex = Math.min(movementSteps, nextPath.length - 1)
      const nextPosition = nextPath[nextIndex] ?? nextPath[0]

      return {
        ...enemy,
        x: nextPosition.x,
        y: nextPosition.y,
        path: nextPath,
        pathIndex: nextIndex,
      }
    })

    this.refreshRouteValidationOrigins()
  }

  private resolveEnemiesAtBase() {
    if (this.state.enemies.length === 0) {
      return
    }

    const survivors: EnemyState[] = []
    for (const enemy of this.state.enemies) {
      if (enemy.x === this.state.base.x && enemy.y === this.state.base.y) {
        this.state.base.hp = Math.max(0, this.state.base.hp - enemy.baseDamage)
        this.appendLog('warn', 'Enemy reached the base', {
          enemyId: enemy.id,
          baseDamage: enemy.baseDamage,
          remainingBaseHp: this.state.base.hp,
        })
        continue
      }

      survivors.push(enemy)
    }

    this.state.enemies = survivors
    this.refreshRouteValidationOrigins()
  }

  private findNearestEnemyInRange(tower: TowerState) {
    let winner: EnemyState | null = null
    let winnerDistance = Number.POSITIVE_INFINITY

    for (const enemy of this.state.enemies) {
      const distance = Math.hypot(enemy.x - tower.x, enemy.y - tower.y)
      if (distance > tower.range || distance >= winnerDistance) {
        continue
      }

      winner = enemy
      winnerDistance = distance
    }

    return winner
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

    for (const enemy of this.state.enemies) {
      origins.push({ x: enemy.x, y: enemy.y })
    }

    this.gridMap.setValidationOrigins(origins)
  }

  private recalculateEnemyPaths() {
    this.state.enemies = this.state.enemies.map((enemy) => {
      const path = this.gridMap.findPath({ x: enemy.x, y: enemy.y }, this.state.map.base)
      return {
        ...enemy,
        path,
        pathIndex: path.length > 1 ? 0 : enemy.pathIndex,
      }
    })
  }

  private syncMapCells() {
    this.state.map.cells = this.gridMap.toCells()
  }

  private findRewardOwner(enemy: EnemyState) {
    if (enemy.lastDamagedByPlayerId) {
      const lastAttacker = this.state.players.find((player) => player.id === enemy.lastDamagedByPlayerId)
      if (lastAttacker) {
        return lastAttacker
      }
    }

    return this.state.players[0]
  }
}