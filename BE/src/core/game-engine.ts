import { ActionQueue } from './action-queue'
import { EnemyFactory } from './enemy-factory'
import { Enemy } from './entities/enemy'
import { Tower } from './entities/tower'
import { TowerBuilder } from './tower-builder'
import { GridMap } from './grid-map'
import type { BuildTowerAction, ClientAction, PlayerIdentity, QueuedAction, UpgradeTowerAction } from '../domain/actions'
import type { EnemyKind, GameLogEntry, GameState, PlayerState, Position, TowerState } from '../domain/game-state'
import type { ServerConfig } from '../config/server-config'
import type { TowerCatalogEntry } from '../domain/tower-catalog'
import { towerCatalog } from '../domain/tower-catalog'
import { buildWaveSpawnSchedule, buildWaveTimeline, getWaveStateForTick, type ScheduledEnemySpawn, type WaveTimelineEntry, waveCatalog } from '../domain/wave-catalog'

type TickListener = (state: GameState) => void
type ActionListener = (action: QueuedAction) => void

export class GameEngine {
  private readonly config: ServerConfig

  private readonly actionQueue = new ActionQueue()

  private readonly tickListeners = new Set<TickListener>()

  private readonly actionListeners = new Set<ActionListener>()

  private readonly enemyFactory = new EnemyFactory()

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
    this.collectDefeatedEnemies()
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
        this.handleUpgradeTower(queuedAction as QueuedAction & { action: UpgradeTowerAction })
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
    const stats = TowerBuilder.getConfigBySelection(type)

    if (!stats) {
      this.appendLog('warn', 'Unknown tower type rejected', { playerId: player.id, type })
      return
    }

    if (!this.isValidBuildPlacement(x, y, stats.width, stats.height)) {
      this.appendLog('warn', 'Build rejected because coordinates are invalid', { playerId: player.id, x, y })
      return
    }

    this.refreshRouteValidationOrigins()
    if (!this.gridMap.canBuildTower(x, y, stats.width, stats.height)) {
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

    const builtTower = TowerBuilder.createFromSelection(type, {
      ownerId: player.id,
      x,
      y,
      tick: this.state.tick,
      sequence: this.towers.length + 1,
    })
    if (!builtTower) {
      this.appendLog('warn', 'Tower builder failed to create tower', { playerId: player.id, type })
      player.gold += stats.cost
      return
    }

    this.towers.push(builtTower.tower)
    this.gridMap.occupy(x, y, stats.width, stats.height)
    this.syncMapCells()
    this.shouldRecalculateEnemyPaths = true
    this.appendLog('info', 'Tower built', { playerId: player.id, towerId: builtTower.state.id, type, x, y })
  }

  private handleUpgradeTower(queuedAction: QueuedAction & { action: UpgradeTowerAction }) {
    const player = this.ensurePlayer(queuedAction.player)
    const towerIndex = this.towers.findIndex((tower) => tower.id === queuedAction.action.towerId)

    if (towerIndex < 0) {
      this.appendLog('warn', 'Upgrade rejected because tower does not exist', {
        playerId: player.id,
        towerId: queuedAction.action.towerId,
      })
      return
    }

    const currentTower = this.towers[towerIndex]
    if (currentTower.ownerId !== player.id) {
      this.appendLog('warn', 'Upgrade rejected because tower owner does not match player', {
        playerId: player.id,
        towerId: currentTower.id,
        ownerId: currentTower.ownerId,
      })
      return
    }

    const currentConfig = TowerBuilder.getConfigBySelection(currentTower.type)
    const nextConfig = TowerBuilder.getNextConfigBySelection(currentTower.type)
    if (!currentConfig || !nextConfig) {
      this.appendLog('warn', 'Upgrade rejected because tower is already at max level', {
        playerId: player.id,
        towerId: currentTower.id,
        type: currentTower.type,
      })
      return
    }

    if (player.gold < nextConfig.cost) {
      this.appendLog('warn', 'Upgrade rejected because player has insufficient gold', {
        playerId: player.id,
        towerId: currentTower.id,
        gold: player.gold,
        requiredGold: nextConfig.cost,
      })
      return
    }

    if (!this.canUpgradeTowerFootprint(currentTower, nextConfig)) {
      this.appendLog('warn', 'Upgrade rejected because upgraded footprint would block placement or pathing', {
        playerId: player.id,
        towerId: currentTower.id,
        type: nextConfig.type,
      })
      return
    }

    player.gold -= nextConfig.cost
    const upgradedTower = TowerBuilder.upgradeTower(currentTower, nextConfig)
    this.towers[towerIndex] = upgradedTower.tower

    if (currentTower.width !== nextConfig.width || currentTower.height !== nextConfig.height) {
      this.gridMap.release(currentTower.x, currentTower.y, currentTower.width, currentTower.height)
      this.gridMap.occupy(currentTower.x, currentTower.y, nextConfig.width, nextConfig.height)
      this.syncMapCells()
      this.shouldRecalculateEnemyPaths = true
    }

    this.appendLog('info', 'Tower upgraded', {
      playerId: player.id,
      towerId: currentTower.id,
      fromType: currentConfig.type,
      toType: nextConfig.type,
      cost: nextConfig.cost,
    })
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
      tower.beginTick()
    }

    this.runTowerPhase('support')
    this.runTowerPhase('action')
  }

  private runTowerPhase(phase: 'support' | 'action') {
    for (const tower of this.towers) {
      if (tower.getPhase() !== phase) {
        continue
      }

      const report = tower.tick({
        enemies: this.enemies,
        towers: this.towers,
        tickRateMs: this.config.tickRateMs,
      })

      for (const attack of report.attacks) {
        this.appendLog('info', 'Tower applied attack effect', {
          towerId: tower.id,
          enemyId: attack.enemyId,
          damage: attack.damage,
          mode: attack.mode,
        })
      }

      if (report.buffedTowerIds.length > 0) {
        this.appendLog('info', 'Tower applied support aura', {
          towerId: tower.id,
          buffedTowerIds: report.buffedTowerIds,
        })
      }

      if (report.grantedGold > 0) {
        const owner = this.state.players.find((player) => player.id === tower.ownerId)
        if (owner) {
          owner.gold += report.grantedGold
        }

        this.appendLog('info', 'Tower generated gold', {
          towerId: tower.id,
          ownerId: tower.ownerId,
          goldGranted: report.grantedGold,
        })
      }
    }
  }

  private collectDefeatedEnemies() {
    const defeatedEnemies = this.enemies.filter((enemy) => !enemy.isAlive())
    if (defeatedEnemies.length === 0) {
      return
    }

    const defeatedEnemyIds = new Set(defeatedEnemies.map((enemy) => enemy.id))
    this.enemies = this.enemies.filter((enemy) => !defeatedEnemyIds.has(enemy.id))

    const splitSpawnQueue: Array<{ kind: EnemyKind, count: number, position: Position, sourceEnemyId: string }> = []

    for (const enemy of defeatedEnemies) {
      const owner = this.findRewardOwner(enemy)
      if (owner) {
        owner.gold += enemy.rewardGold
        owner.score += enemy.rewardGold
      }

      const splitRequests = enemy.collectSplitOnDeathSpawns()
      for (const splitRequest of splitRequests) {
        splitSpawnQueue.push({
          kind: splitRequest.kind,
          count: splitRequest.count,
          position: { x: enemy.x, y: enemy.y },
          sourceEnemyId: enemy.id,
        })
      }

      this.appendLog('info', 'Enemy defeated', { enemyId: enemy.id, rewardGold: enemy.rewardGold })
    }

    for (const splitSpawn of splitSpawnQueue) {
      for (let index = 0; index < splitSpawn.count; index += 1) {
        const splitEnemy = this.spawnEnemyByKind(
          splitSpawn.kind,
          null,
          `split:${splitSpawn.sourceEnemyId}`,
          splitSpawn.position,
        )

        if (!splitEnemy) {
          break
        }
      }
    }

    this.refreshRouteValidationOrigins()
  }

  private updateEnemyPositions(deltaTime: number) {
    const reachedBaseEnemyIds = new Set<string>()

    for (const enemy of this.enemies) {
      enemy.updateEffects(deltaTime)
      if (!enemy.isAlive()) {
        continue
      }

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

  private isValidBuildPlacement(x: number, y: number, width: number, height: number) {
    for (let offsetY = 0; offsetY < height; offsetY += 1) {
      for (let offsetX = 0; offsetX < width; offsetX += 1) {
        const cell = this.gridMap.getCell(x + offsetX, y + offsetY)
        if (cell === null || !cell.buildable || !cell.walkable) {
          return false
        }
      }
    }

    return true
  }

  private canUpgradeTowerFootprint(currentTower: Tower, nextConfig: TowerCatalogEntry) {
    if (currentTower.width === nextConfig.width && currentTower.height === nextConfig.height) {
      return true
    }

    this.gridMap.release(currentTower.x, currentTower.y, currentTower.width, currentTower.height)

    try {
      this.refreshRouteValidationOrigins()
      return this.isValidBuildPlacement(currentTower.x, currentTower.y, nextConfig.width, nextConfig.height)
        && this.gridMap.canBuildTower(currentTower.x, currentTower.y, nextConfig.width, nextConfig.height)
    } finally {
      this.gridMap.occupy(currentTower.x, currentTower.y, currentTower.width, currentTower.height)
    }
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
    return Boolean(
      this.spawnEnemyByKind(
        scheduledSpawn.kind,
        scheduledSpawn.waveIndex,
        scheduledSpawn.waveLabel,
        this.state.map.spawn,
      ),
    )
  }

  private spawnEnemyByKind(kind: EnemyKind, waveIndex: number | null, waveLabel: string, spawn: Position) {
    const anchor = {
      x: Math.round(spawn.x),
      y: Math.round(spawn.y),
    }

    const path = this.gridMap.findPath(anchor.x, anchor.y, this.gridMap.BASE_POINT.x, this.gridMap.BASE_POINT.y)
    if (path === null) {
      this.appendLog('error', 'Enemy spawn skipped because no path exists to base', {
        tick: this.state.tick,
        kind,
        waveIndex,
      })
      return null
    }

    const enemy = this.enemyFactory.createByCode({
      id: `enemy-${kind}-${this.state.tick}-${this.enemies.length + 1}`,
      code: kind,
      spawn,
      path,
    })
    if (!enemy) {
      this.appendLog('warn', 'Enemy spawn skipped because kind is unknown', {
        kind,
        waveIndex,
      })
      return null
    }

    enemy.recalculatePath(spawn.x, spawn.y, path, this.gridMap.BASE_POINT)
    this.enemies.push(enemy)
    this.appendLog('info', 'Enemy spawned', {
      enemyId: enemy.id,
      kind: enemy.kind,
      waveIndex,
      waveLabel,
      x: enemy.x,
      y: enemy.y,
    })
    return enemy
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