import { ActionQueue } from './action-queue'
import type { BuildTowerAction, ClientAction, PlayerIdentity, QueuedAction } from '../domain/actions'
import type { EnemyState, GameLogEntry, GameState, PlayerState, TowerState } from '../domain/game-state'
import type { ServerConfig } from '../config/server-config'

type TickListener = (state: GameState) => void

interface TowerStats {
  cost: number
  damage: number
  range: number
  fireRateTicks: number
}

const towerCatalog: Record<string, TowerStats> = {
  laser: { cost: 50, damage: 20, range: 3.5, fireRateTicks: 4 },
  cannon: { cost: 80, damage: 35, range: 2.5, fireRateTicks: 6 },
}

export class GameEngine {
  private readonly actionQueue = new ActionQueue()

  private readonly tickListeners = new Set<TickListener>()

  private readonly state: GameState

  private lastEnemySpawnTick = -10

  constructor(private readonly config: ServerConfig) {
    this.state = {
      matchId: 'houduan-sandbox',
      tick: 0,
      tickRateMs: config.tickRateMs,
      startedAt: Date.now(),
      map: {
        width: config.mapWidth,
        height: config.mapHeight,
      },
      players: [],
      enemies: [],
      towers: [],
      pendingActions: 0,
      logs: [],
    }

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

  getStateSnapshot(): GameState {
    return structuredClone(this.state)
  }

  tick() {
    this.state.tick += 1
    this.processQueuedActions()
    this.updateEnemies()
    this.updateTowers()
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

    if (this.state.towers.some((tower) => tower.x === x && tower.y === y)) {
      this.appendLog('warn', 'Build rejected because tile is occupied', { playerId: player.id, x, y })
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
    this.appendLog('info', 'Tower built', { playerId: player.id, towerId: tower.id, type, x, y })
  }

  private spawnEnemyIfNeeded() {
    if (this.state.tick - this.lastEnemySpawnTick < 10) {
      return
    }

    this.lastEnemySpawnTick = this.state.tick
    const enemy: EnemyState = {
      id: `enemy-${this.state.tick}`,
      kind: 'runner',
      x: 0,
      y: this.state.enemies.length % this.config.mapHeight,
      hp: 100,
      maxHp: 100,
      speed: 1,
      rewardGold: 15,
    }

    this.state.enemies.push(enemy)
    this.appendLog('info', 'Enemy spawned', { enemyId: enemy.id, x: enemy.x, y: enemy.y })
  }

  private updateEnemies() {
    const survivors: EnemyState[] = []

    for (const enemy of this.state.enemies) {
      const nextX = enemy.x + enemy.speed
      if (nextX >= this.state.map.width) {
        this.appendLog('warn', 'Enemy escaped through the map boundary', { enemyId: enemy.id })
        continue
      }

      survivors.push({
        ...enemy,
        x: nextX,
      })
    }

    this.state.enemies = survivors
  }

  private updateTowers() {
    for (const tower of this.state.towers) {
      if (tower.cooldownTicks > 0) {
        tower.cooldownTicks -= 1
        continue
      }

      const target = this.findNearestEnemyInRange(tower)
      if (!target) {
        continue
      }

      target.hp -= tower.damage
      tower.cooldownTicks = tower.fireRateTicks
      this.appendLog('info', 'Tower fired', { towerId: tower.id, enemyId: target.id, damage: tower.damage })
    }

    const defeatedEnemies = this.state.enemies.filter((enemy) => enemy.hp <= 0)
    if (defeatedEnemies.length === 0) {
      return
    }

    this.state.enemies = this.state.enemies.filter((enemy) => enemy.hp > 0)
    for (const enemy of defeatedEnemies) {
      const owner = this.state.players[0]
      if (owner) {
        owner.gold += enemy.rewardGold
        owner.score += enemy.rewardGold
      }

      this.appendLog('info', 'Enemy defeated', { enemyId: enemy.id, rewardGold: enemy.rewardGold })
    }
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
    return Number.isInteger(x)
      && Number.isInteger(y)
      && x >= 0
      && y >= 0
      && x < this.state.map.width
      && y < this.state.map.height
  }

  private appendLog(level: GameLogEntry['level'], message: string, meta?: Record<string, unknown>) {
    void level
    void message
    void meta
  }
}