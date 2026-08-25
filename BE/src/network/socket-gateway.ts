import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { GameLoop } from '../core/game-loop'
import { ProjectedTickStream } from '../core/projected-tick-stream'
import { Room, RoomManager } from '../core/Room'
import type { PerformanceTelemetry } from '../core/performance-telemetry'
import type { PlayerIdentity } from '../domain/actions'
import type { ServerConfig } from '../config/server-config'
import { submitAction } from './action-submission'
import { ActionRateLimiter } from './action-rate-limiter'
import { authenticateGatewayToken, extractSocketToken, type GatewayPrincipal } from './gateway-auth'
import type { ProgressStore } from '../data/progress-store'
import type { PlayerType } from '../domain/progress'
import { checkPveStageUnlock } from '../core/unlock-logic'
import { LEVEL_CONFIGS } from '../config/level-config'
import {
  getPveStageDefinition,
  isPveDifficulty,
  isPveStageSelection,
  type PveStageSelection,
} from '../../../shared/contracts/pve-stage-config'
import type { PlayerAccountService } from '../account-v1/service'
import { PveRewardService } from '../pve-reward-v1'
import type { GameState } from '../domain/game-state'
import { getPassiveItemDefinition } from '../item-v1'

function readHandshakeValue(socket: Socket, key: string) {
  const queryValue = socket.handshake.query[key]
  if (typeof queryValue === 'string' && queryValue.length > 0) {
    return queryValue
  }

  return undefined
}

interface JoinRoomPayload {
  roomId: string
  playerId?: string
  playerName?: string
  playerKind?: 'human' | 'agent'
}

interface BuildTowerPayload {
  x: number
  y: number
  towerType: string
}

interface RoomRuntime {
  room: Room
  loop: GameLoop
  projectedTickStream: ProjectedTickStream
  unsubscribeProjection: () => void
  unsubscribeSettlement: () => void
  playerConnections: Map<string, number>
  disconnectTimers: Map<string, NodeJS.Timeout>
  ownsProjectedTickStream: boolean
  rewardQueue: Promise<void>
  settledMatchIds: Set<string>
  scheduledRewardKeys: Set<string>
}

interface JoinedRoomContext {
  room: Room
  runtime: RoomRuntime
  identity: PlayerIdentity
}

interface SerializedRoomSummary {
  id: string
  name: string
  hasPassword: boolean
  players: number
  maxPlayers: number
  status: 'OPEN' | 'IN_MATCH' | 'DRAFTING'
  pingMs: number | null
  slots: ReturnType<Room['getSummary']>['slots']
}

const DEFAULT_ROOM_ID = 'public-1'
const COUNTDOWN_DURATION_MS = 3000
const PLAYER_RECONNECT_GRACE_MS = 5000

function isJoinRoomPayload(payload: unknown): payload is JoinRoomPayload {
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as JoinRoomPayload).roomId === 'string'
    && (payload as JoinRoomPayload).roomId.trim().length > 0
}

function parseStageSelection(payload: unknown): PveStageSelection | null {
  if (typeof payload !== 'object' || payload === null) return null
  const candidate = payload as { levelId?: unknown; difficulty?: unknown }
  const difficulty = candidate.difficulty === undefined ? 'easy' : candidate.difficulty
  const selection = { levelId: candidate.levelId, difficulty }
  return isPveStageSelection(selection) ? selection : null
}

function isBuildTowerPayload(payload: unknown): payload is BuildTowerPayload {
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as BuildTowerPayload).x === 'number'
    && typeof (payload as BuildTowerPayload).y === 'number'
    && typeof (payload as BuildTowerPayload).towerType === 'string'
}

export class SocketGateway {
  readonly io: Server

  private readonly config: ServerConfig

  private readonly roomManager: RoomManager

  private readonly roomRuntimes = new Map<string, RoomRuntime>()

  private readonly pveRewardService = new PveRewardService()

  constructor(
    httpServer: HttpServer,
    roomManager: RoomManager,
    config: ServerConfig,
    private readonly telemetry: PerformanceTelemetry,
    private readonly actionLimiter: ActionRateLimiter,
    private readonly progressStore: ProgressStore,
    private readonly defaultProjectedTickStream?: ProjectedTickStream,
    private readonly accountService?: PlayerAccountService,
  ) {
    this.config = config
    this.roomManager = roomManager
    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin === '*' ? true : config.corsOrigin,
        credentials: true,
      },
    })

    this.io.use((socket, next) => {
      const principal = authenticateGatewayToken(this.config, extractSocketToken(socket))
      if (!principal) {
        next(new Error('Missing or invalid gateway token'))
        return
      }

      socket.data.principal = principal
      next()
    })

    this.io.on('connection', (socket) => {
      this.handleConnection(socket)
    })

    for (const room of this.roomManager.listRooms()) {
      this.ensureRoomRuntime(room.id)
    }
  }

  private handleConnection(socket: Socket) {
    this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size)

    socket.on('JOIN_ROOM', (payload: unknown) => {
      this.handleJoinRoom(socket, payload)
    })

    socket.on('SEND_ACTION', (payload: unknown) => {
      this.handleActionSubmission(socket, payload)
    })

    socket.on('BUILD_TOWER', (payload: unknown) => {
      this.handleBuildTower(socket, payload)
    })

    socket.on('START_MATCH', () => {
      this.handleStartMatch(socket)
    })

    socket.on('SELECT_LEVEL', (payload: unknown) => {
      void this.handleSelectLevel(socket, payload)
    })

    socket.on('REQUEST_FULL_STATE', () => {
      this.handleFullStateRequest(socket)
    })

    socket.on('disconnect', () => {
      this.leaveJoinedRoom(socket)
      this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size)
    })
  }

  shutdown(onClosed: () => void) {
    for (const runtime of this.roomRuntimes.values()) {
      runtime.unsubscribeProjection()
      runtime.unsubscribeSettlement()
      if (runtime.ownsProjectedTickStream) {
        runtime.projectedTickStream.dispose()
      }
      runtime.loop.stop()
    }

    this.roomRuntimes.clear()
    this.io.close(onClosed)
  }

  private handleJoinRoom(socket: Socket, payload: unknown) {
    if (!isJoinRoomPayload(payload)) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 roomId')
      return
    }

    const identity = this.resolvePlayerIdentity(socket, payload)
    const nextRoomId = payload.roomId.trim()
    const currentRoomId = this.getJoinedRoomId(socket)
    const currentPlayerId = this.getJoinedIdentity(socket)?.playerId

    if (currentRoomId === nextRoomId && currentPlayerId === identity.playerId) {
      const runtime = this.ensureRoomRuntime(nextRoomId)
      const slot = runtime.room.getPlayerSlot(identity.playerId)
      if (!slot) {
        this.emitEngineError(socket, 'ROOM_JOIN_STATE_INVALID', '玩家房间状态异常，请重新连接')
        return
      }

      this.emitJoinSnapshot(socket, runtime, slot)
      return
    }

    if (currentRoomId && (currentRoomId !== nextRoomId || currentPlayerId !== identity.playerId)) {
      this.leaveJoinedRoom(socket)
    }

    const runtime = this.ensureRoomRuntime(nextRoomId)
    const pendingDisconnectTimer = runtime.disconnectTimers.get(identity.playerId)
    if (pendingDisconnectTimer) {
      clearTimeout(pendingDisconnectTimer)
      runtime.disconnectTimers.delete(identity.playerId)
    }

    const existingSlot = runtime.room.getPlayerSlot(identity.playerId)
    const existingConnections = runtime.playerConnections.get(identity.playerId) ?? 0
    if (!existingSlot && existingConnections === 0 && !runtime.room.isAcceptingNewPlayers()) {
      this.emitEngineError(socket, 'MATCH_IN_PROGRESS', '对局构筑已锁定，只允许原玩家重连')
      return
    }
    const assignedSlot = existingConnections > 0 || existingSlot
      ? existingSlot
      : runtime.room.joinPlayer(identity.playerId)

    if (!assignedSlot) {
      this.emitEngineError(socket, 'ROOM_FULL', 'Room is full')
      return
    }

    runtime.playerConnections.set(identity.playerId, existingConnections + 1)
    runtime.room.engine.registerPlayer(identity)
    socket.join(nextRoomId)
    socket.data.identity = identity
    socket.data.roomId = nextRoomId

    this.emitJoinSnapshot(socket, runtime, assignedSlot)
    this.emitRoomSnapshot(runtime.room)
  }

  private emitJoinSnapshot(socket: Socket, runtime: RoomRuntime, assignedSlot: string) {

    const joinPayload = {
      roomId: runtime.room.id,
      slot: assignedSlot,
      phase: runtime.room.getPhase(),
      hostPlayerId: runtime.room.getHostPlayerId(),
    }

    socket.emit('ROOM_JOINED', joinPayload)

    const fullEnvelope = {
      mode: 'full' as const,
      gameState: runtime.projectedTickStream.getCurrentFullState({ initializeBroadcastBaseline: true }),
      sentAt: Date.now(),
    }

    socket.emit('TICK_UPDATE', fullEnvelope)
    socket.emit('ROOM_SNAPSHOT', this.serializeRoomSummary(runtime.room))
    socket.emit('ROOM_PHASE_CHANGED', { phase: runtime.room.getPhase() })
    this.recordOutbound('socket.TICK_UPDATE.full', fullEnvelope, 1)
  }

  private handleFullStateRequest(socket: Socket) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    const fullEnvelope = {
      mode: 'full' as const,
      gameState: joinedContext.runtime.projectedTickStream.getCurrentFullState(),
      sentAt: Date.now(),
    }

    socket.emit('TICK_UPDATE', fullEnvelope)
    this.recordOutbound('socket.TICK_UPDATE.resync', fullEnvelope, 1)
  }

  private handleActionSubmission(socket: Socket, payload: unknown) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    const submission = submitAction({
      engine: joinedContext.room.engine,
      limiter: this.actionLimiter,
      player: joinedContext.identity,
      payload,
    })

    if (!submission.ok) {
      this.emitEngineError(socket, submission.code, submission.message, submission.retryAfterMs)
      return
    }

    const acceptedPayload = {
      ok: true,
      action: submission.action,
      requestId: submission.requestId,
      actionId: submission.actionId,
      serverTick: submission.serverTick,
      rateLimitRemaining: submission.rateLimitRemaining,
      duplicate: submission.duplicate,
    }

    socket.emit('ACTION_ACCEPTED', acceptedPayload)
    socket.emit('action_accepted', acceptedPayload)
  }

  private handleBuildTower(socket: Socket, payload: unknown) {
    if (!isBuildTowerPayload(payload)) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 x、y、towerType')
      return
    }

    this.handleActionSubmission(socket, {
      action: 'BUILD_TOWER',
      x: payload.x,
      y: payload.y,
      type: payload.towerType,
    })
  }

  private handleStartMatch(socket: Socket) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    void this.beginRoomCountdown(joinedContext, socket)
  }

  private async handleSelectLevel(socket: Socket, payload: unknown) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    if (joinedContext.identity.playerId !== joinedContext.room.getHostPlayerId()) {
      this.emitEngineError(socket, 'FORBIDDEN', '只有房主有权选择难度')
      return
    }

    const selection = parseStageSelection(payload)
    if (!selection) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少或无效的 levelId、difficulty')
      return
    }

    const levelConfig = LEVEL_CONFIGS[selection.levelId]
    if (!levelConfig) {
      this.emitEngineError(socket, 'INVALID_LEVEL', `Level ${selection.levelId} 不存在`)
      return
    }

    if (!this.accountService) {
      this.emitEngineError(socket, 'ACCOUNT_SERVICE_UNAVAILABLE', '关卡进度服务暂不可用')
      return
    }

    const participantIds = joinedContext.room.getConnectedPlayerIds()
    const participantAccounts = await Promise.all(participantIds.map(playerId => this.accountService!.getOrCreate(playerId)))
    const lockedParticipant = participantAccounts.find(account => !checkPveStageUnlock(account.pveProgress, selection).allowed)
    if (lockedParticipant) {
      const unlockResult = checkPveStageUnlock(lockedParticipant.pveProgress, selection)
      this.emitEngineError(socket, 'LEVEL_LOCKED', `玩家 ${lockedParticipant.playerId} 未解锁：${unlockResult.allowed ? '前置不满足' : unlockResult.reason}`)
      return
    }

    if (!levelConfig.allowedPlayerKinds.includes(joinedContext.identity.playerKind)) {
      this.emitEngineError(socket, 'LEVEL_LOCKED', '当前玩家类型不允许进入该关卡')
      return
    }

    const currentPhase = joinedContext.room.getPhase()
    if (currentPhase === 'playing') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前对局已开始，不能再次选择难度')
      return
    }

    if (currentPhase === 'lobby' || currentPhase === 'countdown') {
      joinedContext.room.setPendingStageSelection(selection)

      if (currentPhase === 'lobby') {
        void this.beginRoomCountdown(joinedContext, socket)
      }

      return
    }

    if (currentPhase !== 'waiting_for_level') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前状态不接受难度选择，请等待倒计时完成')
      return
    }

    this.activateRoomLevel(joinedContext.room, levelConfig, selection)
  }

  private async beginRoomCountdown(joinedContext: JoinedRoomContext, socket: Socket) {
    const result = await joinedContext.room.beginCountdown(joinedContext.identity.playerId, () => {
      this.handleCountdownCompleted(joinedContext.room)
    })

    if (result === 'forbidden') {
      this.emitEngineError(socket, 'FORBIDDEN', '只有房主可以启动游戏')
      return false
    }

    if (result === 'wrong_phase') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前房间状态不允许启动该操作')
      return false
    }

    if (result === 'snapshot_failed') {
      this.emitEngineError(socket, 'BUILD_SNAPSHOT_FAILED', '局外构筑锁定失败，对局未启动，请重试')
      return false
    }

    const countdownPayload = {
      phase: 'countdown' as const,
      durationMs: COUNTDOWN_DURATION_MS,
      remainingSeconds: COUNTDOWN_DURATION_MS / 1000,
    }

    this.io.to(joinedContext.room.id).emit('START_MATCH_ACCEPTED', countdownPayload)
    this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', countdownPayload)
    this.emitRoomSnapshot(joinedContext.room)
    this.scheduleCountdownBroadcast(joinedContext.room)
    return true
  }

  private handleCountdownCompleted(room: Room) {
    const pendingSelection = room.consumePendingStageSelection()
    if (pendingSelection === null) {
      this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'waiting_for_level' as const })
      this.emitRoomSnapshot(room)
      return
    }

    const levelConfig = LEVEL_CONFIGS[pendingSelection.levelId]
    if (!levelConfig) {
      this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'waiting_for_level' as const })
      return
    }

    this.activateRoomLevel(room, levelConfig, pendingSelection)
  }

  private activateRoomLevel(
    room: Room,
    levelConfig: (typeof LEVEL_CONFIGS)[number],
    selection: PveStageSelection,
  ) {
    room.igniteWithLevel(levelConfig.waves, selection, levelConfig.startingGold)

    const levelSelectedPayload = {
      levelId: levelConfig.levelId,
      difficulty: selection.difficulty,
      label: levelConfig.label,
      description: levelConfig.description,
      targetClearRate: levelConfig.targetClearRate,
      waveCount: levelConfig.waves.length,
      minPlayers: levelConfig.minPlayers,
    }

    this.io.to(room.id).emit('LEVEL_SELECTED', levelSelectedPayload)
    this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'playing', levelId: levelConfig.levelId })
    this.emitRoomSnapshot(room)
  }

  private scheduleCountdownBroadcast(room: Room) {
    const countdownSeconds = [2, 1]

    countdownSeconds.forEach((remainingSeconds) => {
      setTimeout(() => {
        if (room.getPhase() !== 'countdown') {
          return
        }

        this.io.to(room.id).emit('COUNTDOWN_TICK', {
          phase: 'countdown',
          remainingSeconds,
          remainingMs: remainingSeconds * 1000,
        })
      }, (COUNTDOWN_DURATION_MS / 1000 - remainingSeconds) * 1000)
    })
  }

  private ensureRoomRuntime(roomId: string) {
    const existingRuntime = this.roomRuntimes.get(roomId)
    if (existingRuntime) {
      return existingRuntime
    }

    const room = this.roomManager.getOrCreateRoom(roomId)
    const usesSharedProjectedTickStream = roomId === DEFAULT_ROOM_ID && Boolean(this.defaultProjectedTickStream)
    const projectedTickStream = usesSharedProjectedTickStream
      ? this.defaultProjectedTickStream as ProjectedTickStream
      : new ProjectedTickStream(room.engine, this.config, this.telemetry)
    const loop = new GameLoop(room.engine, this.config.tickRateMs)
    room.engine.attachPerformanceTelemetry(this.telemetry)

    const runtime: RoomRuntime = {
      room,
      loop,
      projectedTickStream,
      playerConnections: new Map(),
      disconnectTimers: new Map(),
      ownsProjectedTickStream: !usesSharedProjectedTickStream,
      unsubscribeProjection: () => {},
      unsubscribeSettlement: () => {},
      rewardQueue: Promise.resolve(),
      settledMatchIds: new Set(),
      scheduledRewardKeys: new Set(),
    }

    runtime.unsubscribeSettlement = room.engine.onTick((state) => {
      this.schedulePveRewardWork(runtime, state)
    }, { label: 'pve-reward-settlement' })

    runtime.unsubscribeProjection = projectedTickStream.subscribeBroadcast((event) => {
      const recipientCount = this.io.sockets.adapter.rooms.get(room.id)?.size ?? 0
      if (recipientCount === 0) {
        return
      }

      if (!event.shouldSocketBroadcast || !event.broadcast) {
        return
      }

      if (event.shouldFullSnapshot) {
        const checkpointEnvelope = {
          mode: 'checkpoint' as const,
          patch: event.broadcast.checkpoint,
          sentAt: Date.now(),
        }

        this.io.to(room.id).emit('TICK_UPDATE', checkpointEnvelope)
        this.recordOutbound('socket.TICK_UPDATE.checkpoint', checkpointEnvelope, recipientCount)

        if (Object.keys(event.broadcast.uiUpdate).length > 0) {
          this.io.to(room.id).emit('UI_STATE_UPDATE', event.broadcast.uiUpdate)
          this.recordOutbound('socket.UI_STATE_UPDATE', event.broadcast.uiUpdate, recipientCount)
        }

        if (event.broadcast.noticeUpdate) {
          this.io.to(room.id).emit('NOTICE_UPDATE', event.broadcast.noticeUpdate)
          this.recordOutbound('socket.NOTICE_UPDATE', event.broadcast.noticeUpdate, recipientCount)
        }
        return
      }

      const tickEnvelope = {
        mode: 'patch' as const,
        patch: event.broadcast.patch,
        sentAt: Date.now(),
      }

      this.io.to(room.id).emit('TICK_UPDATE', tickEnvelope)
      this.recordOutbound('socket.TICK_UPDATE.patch', tickEnvelope, recipientCount)

      if (Object.keys(event.broadcast.uiUpdate).length > 0) {
        this.io.to(room.id).emit('UI_STATE_UPDATE', event.broadcast.uiUpdate)
        this.recordOutbound('socket.UI_STATE_UPDATE', event.broadcast.uiUpdate, recipientCount)
      }

      if (event.broadcast.noticeUpdate) {
        this.io.to(room.id).emit('NOTICE_UPDATE', event.broadcast.noticeUpdate)
        this.recordOutbound('socket.NOTICE_UPDATE', event.broadcast.noticeUpdate, recipientCount)
      }
    })

    loop.start()
    this.roomRuntimes.set(roomId, runtime)
    return runtime
  }

  private schedulePveRewardWork(runtime: RoomRuntime, state: GameState) {
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    if (!selection || !state.pve || !this.accountService) return
    const milestones = [5, 10, 15, 20] as const
    const dueMilestones = state.pve.players.flatMap(player => milestones
      // 波次允许重叠，后续波次先清完不能被误判为前一个 Boss 已死亡。
      .filter(milestone => player.clearedWaves.includes(milestone))
      .map(milestone => ({ playerId: player.playerId, milestone })))
      .filter(({ playerId, milestone }) => !runtime.scheduledRewardKeys.has(
        `${state.matchId}:${playerId}:wave-${milestone}`,
      ))
    const needsSettlement = state.status === 'finished' && !runtime.settledMatchIds.has(state.matchId)
      && !runtime.scheduledRewardKeys.has(`${state.matchId}:settlement`)
    if (dueMilestones.length === 0 && !needsSettlement) return

    for (const due of dueMilestones) {
      runtime.scheduledRewardKeys.add(`${state.matchId}:${due.playerId}:wave-${due.milestone}`)
    }
    if (needsSettlement) runtime.scheduledRewardKeys.add(`${state.matchId}:settlement`)
    const stateSnapshot = structuredClone(state)
    runtime.rewardQueue = runtime.rewardQueue
      .then(async () => {
        const milestoneResults = await Promise.allSettled(dueMilestones.map(due => (
          this.recordPveMilestone(runtime, stateSnapshot, due.playerId, due.milestone)
        )))
        const milestoneFailures: string[] = []
        milestoneResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const due = dueMilestones[index]
            runtime.scheduledRewardKeys.delete(`${state.matchId}:${due.playerId}:wave-${due.milestone}`)
            milestoneFailures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
          }
        })
        if (milestoneFailures.length > 0) throw new Error(milestoneFailures.join(', '))
        if (needsSettlement) await this.settleFinishedPveMatch(runtime, stateSnapshot)
      })
      .catch((error) => {
        if (needsSettlement) runtime.scheduledRewardKeys.delete(`${state.matchId}:settlement`)
        const details = error instanceof Error ? error.message : String(error)
        console.error(`PVE reward processing failed for ${state.matchId}: ${details}`)
      })
  }

  private async recordPveMilestone(
    runtime: RoomRuntime,
    state: GameState,
    playerId: string,
    milestone: 5 | 10 | 15 | 20,
  ) {
    if (!this.accountService) throw new Error('PLAYER_ACCOUNT_SERVICE_NOT_CONFIGURED')
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    const stage = selection ? getPveStageDefinition(selection.levelId) : null
    const player = state.pve?.players.find(candidate => candidate.playerId === playerId)
    if (!selection || !stage || !player || !isPveDifficulty(selection.difficulty)) {
      throw new Error('PVE_REWARD_CONTEXT_INCOMPLETE')
    }
    const account = await this.accountService.getOrCreate(playerId)
    this.pveRewardService.recordWaveMilestone({
      matchId: state.matchId,
      matchSeed: state.matchId,
      stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
      playerId,
      milestone,
      activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
      discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
      weaponState: {
        fragmentBalances: account.weapon.fragmentBalances,
        unlockedWeaponIds: account.weapon.unlockedWeaponIds,
      },
      bossFragmentBonus: this.resolveBossFragmentBonus(runtime.room, playerId),
    })
  }

  private resolveBossFragmentBonus(room: Room, playerId: string) {
    const build = room.getMatchBuildSnapshot(playerId)
    if (!build) return undefined
    for (const itemId of build.item.passiveSlots) {
      if (!itemId) continue
      const definition = getPassiveItemDefinition(itemId)
      const modifier = definition?.ruleModifiers.find(candidate => candidate.type === 'boss_fragment_bonus')
      if (modifier?.type === 'boss_fragment_bonus') {
        return {
          chanceBps: modifier.chanceBps,
          extraCount: modifier.extraCount,
          maxExtraPerBoss: modifier.maxExtraPerBoss,
          qualityPolicy: modifier.qualityPolicy,
        } as const
      }
    }
    return undefined
  }

  private async settleFinishedPveMatch(runtime: RoomRuntime, state: GameState) {
    if (!this.accountService || !state.pve || !state.result) return
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    const stage = selection ? getPveStageDefinition(selection.levelId) : null
    if (!selection || !stage) throw new Error('PVE_SETTLEMENT_CONTEXT_INCOMPLETE')
    const officialVictory = state.result.outcome === 'victory'
    const failures: string[] = []

    for (const player of state.pve.players) {
      try {
        const account = await this.accountService.getOrCreate(player.playerId)
        if (account.settlementsById[`${state.matchId}:${player.playerId}`]) continue
        const rewardContext = {
          matchId: state.matchId,
          matchSeed: state.matchId,
          stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
          playerId: player.playerId,
          activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
          discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
          weaponState: {
            fragmentBalances: account.weapon.fragmentBalances,
            unlockedWeaponIds: account.weapon.unlockedWeaponIds,
          },
        } as const
        this.pveRewardService.recordMatchOutcome({ ...rewardContext, officialVictory })
        const frozenRewards = this.pveRewardService.ledger.freezePlayerRewards(state.matchId, player.playerId)
        await runtime.room.commitPlayerSettlement({
          requestId: `settle:${state.matchId}:${player.playerId}`,
          matchId: state.matchId,
          playerId: player.playerId,
          reason: officialVictory ? 'victory' : 'defeat',
          highestCompletedWave: player.highestCompletedWave,
          officialVictory,
          retainedWeaponFragments: frozenRewards.fragmentBalances,
          stageSelection: selection,
        })
      }
      catch (error) {
        failures.push(`${player.playerId}:${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length > 0) throw new Error(failures.join(', '))
    runtime.settledMatchIds.add(state.matchId)
  }

  private async settleDepartingPvePlayer(runtime: RoomRuntime, playerId: string) {
    if (!this.accountService) return
    const state = runtime.room.engine.getStateSnapshot()
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    const stage = selection ? getPveStageDefinition(selection.levelId) : null
    const player = state.pve?.players.find(candidate => candidate.playerId === playerId)
    if (state.status !== 'running' || !selection || !stage || !player) return
    const account = await this.accountService.getOrCreate(playerId)
    if (account.settlementsById[`${state.matchId}:${playerId}`]) return
    for (const milestone of [5, 10, 15, 20] as const) {
      if (player.clearedWaves.includes(milestone)) {
        await this.recordPveMilestone(runtime, state, playerId, milestone)
      }
    }
    this.pveRewardService.recordMatchOutcome({
      matchId: state.matchId,
      matchSeed: state.matchId,
      stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
      playerId,
      activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
      discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
      weaponState: {
        fragmentBalances: account.weapon.fragmentBalances,
        unlockedWeaponIds: account.weapon.unlockedWeaponIds,
      },
      officialVictory: false,
    })
    const frozenRewards = this.pveRewardService.ledger.freezePlayerRewards(state.matchId, playerId)
    await runtime.room.commitPlayerSettlement({
      requestId: `settle:${state.matchId}:${playerId}`,
      matchId: state.matchId,
      playerId,
      reason: 'disconnect_exit',
      highestCompletedWave: player.highestCompletedWave,
      officialVictory: false,
      retainedWeaponFragments: frozenRewards.fragmentBalances,
      stageSelection: selection,
    })
  }

  private leaveJoinedRoom(socket: Socket) {
    const roomId = this.getJoinedRoomId(socket)
    const identity = this.getJoinedIdentity(socket)
    if (!roomId || !identity) {
      return
    }

    const runtime = this.roomRuntimes.get(roomId)
    if (!runtime) {
      delete socket.data.roomId
      delete socket.data.identity
      return
    }

    const activeConnectionCount = runtime.playerConnections.get(identity.playerId) ?? 0
    if (activeConnectionCount <= 1) {
      runtime.playerConnections.delete(identity.playerId)
      runtime.room.engine.markPlayerDisconnected(identity.playerId)
      this.emitRoomSnapshot(runtime.room)

      const disconnectTimer = setTimeout(() => {
        runtime.disconnectTimers.delete(identity.playerId)

        if ((runtime.playerConnections.get(identity.playerId) ?? 0) > 0) {
          return
        }

        void this.settleDepartingPvePlayer(runtime, identity.playerId)
          .catch((error) => {
            console.error(`PVE disconnect settlement failed for ${identity.playerId}: ${error instanceof Error ? error.message : String(error)}`)
          })
          .finally(() => {
            runtime.room.leavePlayer(identity.playerId)
            this.emitRoomSnapshot(runtime.room)
            this.cleanupRoomIfEmpty(roomId)
          })
      }, PLAYER_RECONNECT_GRACE_MS)

      runtime.disconnectTimers.set(identity.playerId, disconnectTimer)
    } else {
      runtime.playerConnections.set(identity.playerId, activeConnectionCount - 1)
      this.emitRoomSnapshot(runtime.room)
    }

    socket.leave(roomId)
    delete socket.data.roomId
    delete socket.data.identity
  }

  private cleanupRoomIfEmpty(roomId: string) {
    const runtime = this.roomRuntimes.get(roomId)
    if (!runtime || !runtime.room.isEmpty()) {
      return
    }

    for (const disconnectTimer of runtime.disconnectTimers.values()) {
      clearTimeout(disconnectTimer)
    }

    runtime.disconnectTimers.clear()

    runtime.unsubscribeProjection()
    runtime.unsubscribeSettlement()
    if (runtime.ownsProjectedTickStream) {
      runtime.projectedTickStream.dispose()
    }
    runtime.loop.stop()
    this.roomRuntimes.delete(roomId)
    this.roomManager.removeRoom(roomId)
  }

  private getJoinedContext(socket: Socket) {
    const roomId = this.getJoinedRoomId(socket)
    const identity = this.getJoinedIdentity(socket)
    if (!roomId || !identity) {
      return null
    }

    const runtime = this.roomRuntimes.get(roomId)
    if (!runtime) {
      return null
    }

    return {
      room: runtime.room,
      runtime,
      identity,
    }
  }

  private getJoinedRoomId(socket: Socket) {
    return typeof socket.data.roomId === 'string' ? socket.data.roomId : null
  }

  private getJoinedIdentity(socket: Socket): PlayerIdentity | null {
    const identity = socket.data.identity
    if (!identity || typeof identity !== 'object') {
      return null
    }

    const candidate = identity as Partial<PlayerIdentity>
    if (
      typeof candidate.playerId !== 'string'
      || typeof candidate.playerName !== 'string'
      || (candidate.playerKind !== 'human' && candidate.playerKind !== 'agent')
    ) {
      return null
    }

    return candidate as PlayerIdentity
  }

  private resolvePlayerIdentity(socket: Socket, overrides?: Partial<JoinRoomPayload>): PlayerIdentity {
    const principal = socket.data.principal as GatewayPrincipal | undefined
    const requestedPlayerId = overrides?.playerId ?? readHandshakeValue(socket, 'playerId')
    const requestedPlayerName = overrides?.playerName ?? readHandshakeValue(socket, 'playerName')
    const isOAuthSession = principal?.token.startsWith('sess_') ?? false
    const playerId = isOAuthSession
      ? principal?.playerId ?? requestedPlayerId ?? socket.id
      : requestedPlayerId ?? principal?.playerId ?? socket.id
    const playerName = isOAuthSession
      ? principal?.playerName ?? requestedPlayerName ?? `player-${playerId.slice(0, 6)}`
      : requestedPlayerName ?? principal?.playerName ?? `player-${playerId.slice(0, 6)}`
    const playerKind = principal?.playerKind ?? overrides?.playerKind ?? (readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human')

    return {
      playerId,
      playerName,
      playerKind,
    }
  }

  private serializeRoomSummary(room: Room): SerializedRoomSummary {
    const summary = room.getSummary()
    return {
      id: summary.id,
      name: summary.name,
      hasPassword: summary.hasPassword,
      players: summary.players,
      maxPlayers: summary.maxPlayers,
      status: summary.phase === 'playing'
        ? 'IN_MATCH'
        : summary.phase === 'countdown' || summary.phase === 'waiting_for_level'
          ? 'DRAFTING'
          : 'OPEN',
      pingMs: null,
      slots: summary.slots,
    }
  }

  private emitRoomSnapshot(room: Room) {
    this.io.to(room.id).emit('ROOM_SNAPSHOT', this.serializeRoomSummary(room))
  }

  private emitEngineError(socket: Socket, code: string, message: string, retryAfterMs?: number) {
    socket.emit('engine_error', {
      code,
      message,
      retryAfterMs,
    })
  }

  private recordOutbound(metricName: string, payload: unknown, recipientCount: number) {
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    this.telemetry.incrementCounter(`${metricName}.messages`, 1)
    this.telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes * recipientCount)
    this.telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes)
  }
}
