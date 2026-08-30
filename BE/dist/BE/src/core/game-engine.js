"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEngine = void 0;
exports.projectPveEnemySnapshot = projectPveEnemySnapshot;
const action_queue_1 = require("./action-queue");
const grid_map_1 = require("./grid-map");
const node_perf_hooks_1 = require("node:perf_hooks");
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
const hero_v1_1 = require("./hero-v1");
const service_1 = require("../account-v1/service");
const pve_v2_1 = require("../pve-v2");
const arena_layout_1 = require("../config/arena-layout");
const SLOT_ORDER = ['P1', 'P2', 'P3', 'P4'];
function clonePosition(position) {
    return { x: position.x, y: position.y };
}
function clonePath(path) {
    return path.map(clonePosition);
}
function normalizePlayerCount(playerCount) {
    if (!Number.isFinite(playerCount)) {
        return 1;
    }
    return Math.max(1, Math.min(4, Math.floor(playerCount)));
}
function normalizeActiveSlots(activeSlots) {
    const uniqueSlots = new Set();
    for (const slot of activeSlots ?? []) {
        if (SLOT_ORDER.includes(slot)) {
            uniqueSlots.add(slot);
        }
    }
    return uniqueSlots.size > 0 ? [...uniqueSlots] : ['P1'];
}
function createFallbackLaneRoutes() {
    return {
        P1: {
            slot: 'P1',
            spawn: (0, arena_layout_1.getArenaLaneSpawnPoint)('P1'),
            path: (0, arena_layout_1.createArenaEnemyLanePath)('P1'),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P1),
        },
        P2: {
            slot: 'P2',
            spawn: (0, arena_layout_1.getArenaLaneSpawnPoint)('P2'),
            path: (0, arena_layout_1.createArenaEnemyLanePath)('P2'),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P2),
        },
        P3: {
            slot: 'P3',
            spawn: (0, arena_layout_1.getArenaLaneSpawnPoint)('P3'),
            path: (0, arena_layout_1.createArenaEnemyLanePath)('P3'),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P3),
        },
        P4: {
            slot: 'P4',
            spawn: (0, arena_layout_1.getArenaLaneSpawnPoint)('P4'),
            path: (0, arena_layout_1.createArenaEnemyLanePath)('P4'),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P4),
        },
    };
}
function createFallbackMapCells(width, height) {
    return {
        cells: (0, arena_layout_1.createArenaMapCells)(width, height),
        spawnPoint: (0, arena_layout_1.getArenaPrimarySpawnPoint)(),
        basePoint: (0, arena_layout_1.getArenaPrimaryBasePoint)(),
    };
}
function createPveLaneRouteSnapshots(laneRoutes) {
    return Object.fromEntries(SLOT_ORDER.map((slot) => {
        const route = laneRoutes[slot];
        return [slot, {
                waypoints: clonePath(route.path),
                loopStartIndex: route.loopStartIndex ?? 0,
            }];
    }));
}
/** 纯函数投影，供协议契约测试复用；空间出生锁与战斗无敌保持独立。 */
function projectPveEnemySnapshot(enemy, loopStartIndex) {
    return {
        entityId: enemy.id,
        entityKind: enemy.entityKind,
        bossDefinitionId: enemy.bossDefinitionId,
        bossName: enemy.bossName,
        controlResistanceBps: enemy.controlResistanceBps,
        bossPhase: enemy.bossPhase,
        activeCast: enemy.activeCast ? structuredClone(enemy.activeCast) : null,
        glyph: enemy.glyph,
        waveNumber: enemy.waveNumber,
        homeLanePlayerId: enemy.laneOwnerPlayerId,
        homeSlotId: enemy.laneSlot,
        routeZone: enemy.routeWaypointIndex >= loopStartIndex ? 'public_loop' : 'private_lane',
        hp: enemy.currentHp,
        maxHp: enemy.maxHp,
        armor: enemy.armor,
        magicResistance: enemy.magicResistance,
        moveSpeedMilliCellsPerSecond: enemy.moveSpeedMilliCellsPerSecond,
        pathIndex: enemy.routeWaypointIndex,
        pathProgressMilli: enemy.pathProgressMilli,
        lapCount: enemy.lapCount,
        spawnProtected: enemy.spawnProtected,
        invulnerable: enemy.invulnerable,
        x: enemy.xMilli / 1000,
        y: enemy.yMilli / 1000,
    };
}
class GameEngine {
    config;
    roomId;
    actionQueue = new action_queue_1.ActionQueue();
    tickListeners = new Map();
    actionListeners = new Set();
    pveActionAppliedListeners = new Set();
    state;
    gridMap;
    laneRoutes;
    pveRuntime;
    matchBuildSnapshots = {};
    matchSequence = 0;
    playerSlots = new Map();
    pveStarted = false;
    actionSequence = 0;
    actionRequestReceipts = new Map();
    lastPveWaveNumber = 0;
    pveWaveStartedAtTick = 0;
    activeSlots;
    playerCount;
    maxCapacity;
    overloadTicks = 0;
    performanceTelemetry = null;
    constructor(config, options = {}) {
        this.config = config;
        this.roomId = options.roomId ?? 'default';
        this.playerCount = normalizePlayerCount(options.playerCount ?? 1);
        this.maxCapacity = this.playerCount * 10;
        this.activeSlots = normalizeActiveSlots(options.activeSlots);
        this.laneRoutes = options.laneRoutes ?? createFallbackLaneRoutes();
        this.pveRuntime = this.createPveRuntime();
        const fallbackMap = createFallbackMapCells(config.mapWidth, config.mapHeight);
        const spawnPoint = options.spawnPoint ?? fallbackMap.spawnPoint;
        const basePoint = options.basePoint ?? fallbackMap.basePoint;
        this.gridMap = new grid_map_1.GridMap(options.mapCells ?? fallbackMap.cells, spawnPoint, basePoint);
        this.state = {
            matchId: config.matchId,
            tick: 0,
            tickRateMs: config.tickRateMs,
            startedAt: Date.now(),
            status: 'waiting',
            result: null,
            playerCount: this.playerCount,
            maxCapacity: this.maxCapacity,
            overloadTicks: this.overloadTicks,
            overloadCountdownSec: 0,
            map: {
                width: config.mapWidth,
                height: config.mapHeight,
                cells: this.gridMap.toCells(),
                spawn: clonePosition(spawnPoint),
                base: clonePosition(basePoint),
            },
            base: {
                x: basePoint.x,
                y: basePoint.y,
                hp: 20,
                maxHp: 20,
            },
            wave: {
                index: 0,
                label: '无波次',
                startedAtTick: 0,
                endsAtTick: null,
                remainingSpawns: 0,
                prepCountdownSec: 0,
            },
            players: [],
            enemies: [],
            towers: [],
            pendingActions: 0,
            logs: [],
            pve: this.projectPveSnapshot(this.pveRuntime.snapshot()),
        };
        this.appendLog('info', 'GameEngine initialized', {
            roomId: this.roomId,
            tickRateMs: config.tickRateMs,
            mapWidth: config.mapWidth,
            mapHeight: config.mapHeight,
            playerCount: this.playerCount,
            maxCapacity: this.maxCapacity,
            activeSlots: this.activeSlots,
        });
    }
    registerPlayer(identity) {
        const existingPlayer = this.state.players.find((player) => player.id === identity.playerId);
        if (existingPlayer) {
            existingPlayer.name = identity.playerName;
            existingPlayer.kind = identity.playerKind;
            existingPlayer.connectionStatus = 'connected';
            this.registerPvePlayer(identity.playerId);
            this.appendLog('info', 'Player reconnected', { playerId: identity.playerId, kind: identity.playerKind });
            return;
        }
        const player = {
            id: identity.playerId,
            name: identity.playerName,
            kind: identity.playerKind,
            gold: this.config.playerStartingGold,
            score: 0,
            connectionStatus: 'connected',
            lastActionAt: null,
        };
        this.state.players.push(player);
        this.registerPvePlayer(player.id);
        // 不在这里自动切换到 'running'；由 ignite() 在关卡选择后触发
        this.appendLog('info', 'Player registered', { playerId: player.id, kind: player.kind });
    }
    markPlayerDisconnected(playerId) {
        const player = this.state.players.find((item) => item.id === playerId);
        if (!player) {
            return;
        }
        player.connectionStatus = 'disconnected';
        this.appendLog('warn', 'Player disconnected', { playerId });
    }
    markPlayerReconnecting(playerId) {
        const player = this.state.players.find((item) => item.id === playerId);
        if (!player)
            return;
        player.connectionStatus = 'reconnecting';
        this.appendLog('warn', 'Player reconnect grace started', { playerId });
    }
    restorePlayerConnection(identity) {
        const player = this.state.players.find((item) => item.id === identity.playerId);
        if (!player)
            return false;
        player.name = identity.playerName;
        player.kind = identity.playerKind;
        player.connectionStatus = 'connected';
        this.appendLog('info', 'Player connection restored', { playerId: identity.playerId, kind: identity.playerKind });
        return true;
    }
    setPlayerCount(playerCount) {
        this.playerCount = normalizePlayerCount(playerCount);
        if (this.pveStarted) {
            this.syncPveRuntimeState();
            return;
        }
        this.maxCapacity = this.playerCount * 10;
        this.state.playerCount = this.playerCount;
        this.state.maxCapacity = this.maxCapacity;
    }
    setActiveSlots(activeSlots) {
        this.activeSlots = normalizeActiveSlots(activeSlots);
    }
    syncPlayerSlots(assignments) {
        const nextPlayerIds = new Set(assignments.map(({ playerId }) => playerId));
        for (const playerId of this.playerSlots.keys()) {
            if (!nextPlayerIds.has(playerId)) {
                this.pveRuntime.unregister(playerId);
            }
        }
        this.playerSlots.clear();
        for (const { playerId, slotId } of assignments) {
            this.playerSlots.set(playerId, slotId);
            const build = this.matchBuildSnapshots[playerId];
            this.pveRuntime.registerPlayer(playerId, slotId, this.resolvePveGeneralSelection(build));
        }
        this.syncPveRuntimeState();
    }
    resolveActionRequest(playerId, requestId, action) {
        const receipt = this.actionRequestReceipts.get(`${playerId}:${requestId}`);
        if (!receipt)
            return { status: 'new' };
        if (receipt.fingerprint !== JSON.stringify(action))
            return { status: 'conflict' };
        return {
            status: 'replay',
            actionId: receipt.actionId,
            serverTick: receipt.serverTick,
            rateLimitRemaining: receipt.rateLimitRemaining,
        };
    }
    enqueueAction(player, action, clientRequestId = null, rateLimitRemaining = 0, forcedActionId) {
        if (!forcedActionId)
            this.actionSequence += 1;
        const queuedAction = {
            id: forcedActionId ?? `${player.playerId}:${this.actionSequence}`,
            clientRequestId,
            receivedAt: Date.now(),
            player,
            action,
        };
        this.actionQueue.enqueue(queuedAction);
        this.state.pendingActions = this.actionQueue.size();
        const actor = this.ensurePlayer(player);
        actor.lastActionAt = queuedAction.receivedAt;
        const actionSnapshot = structuredClone(queuedAction);
        for (const listener of this.actionListeners) {
            listener(actionSnapshot);
        }
        this.appendLog('info', 'Action queued', {
            queueSize: this.actionQueue.size(),
            playerId: player.playerId,
            action: action.action,
        });
        const receipt = {
            actionId: queuedAction.id,
            serverTick: this.state.tick,
        };
        if (clientRequestId) {
            this.actionRequestReceipts.set(`${player.playerId}:${clientRequestId}`, {
                fingerprint: JSON.stringify(action),
                ...receipt,
                rateLimitRemaining,
            });
        }
        return receipt;
    }
    attachPerformanceTelemetry(performanceTelemetry) {
        this.performanceTelemetry = performanceTelemetry;
        this.performanceTelemetry.setGauge('engine.tick.listeners', this.tickListeners.size);
        this.performanceTelemetry.setGauge('engine.action.listeners', this.actionListeners.size);
    }
    /**
     * 房间在 ignite 前注入局外构筑快照。运行时只使用该冻结副本，
     * 对局中账户后续换装不会污染当前对局。
     */
    setMatchBuildSnapshots(snapshots) {
        if (this.pveStarted)
            throw new Error('MATCH_BUILD_SNAPSHOTS_LOCKED');
        this.matchBuildSnapshots = structuredClone(snapshots);
        // Slots are registered when players join, before the account build is
        // locked at countdown. Refresh waiting players immediately so the runtime
        // drops its safe starter fallback and uses the account-scoped selection.
        for (const [playerId, slotId] of this.playerSlots.entries()) {
            this.pveRuntime.unregister(playerId);
            this.pveRuntime.registerPlayer(playerId, slotId, this.resolvePveGeneralSelection(this.matchBuildSnapshots[playerId]));
        }
        this.syncPveRuntimeState();
    }
    /**
     * Apply the room's final pre-match general selections after the account build
     * snapshot has been locked, but before the PVE runtime is started.  Level
     * selection happens after START_MATCH in the current room lifecycle, so this
     * keeps the immutable account snapshot while still freezing the in-match pool
     * at the authoritative ignite boundary.
     */
    setMatchGeneralSelections(selections) {
        if (this.pveStarted)
            throw new Error('MATCH_GENERAL_SELECTIONS_LOCKED');
        const next = structuredClone(this.matchBuildSnapshots);
        for (const [playerId, selectedGeneralIds] of Object.entries(selections)) {
            const build = next[playerId];
            if (!build)
                continue;
            const unlocked = new Set(build.unlockedGeneralIds ?? []);
            const selected = [...new Set(selectedGeneralIds)].sort();
            if (selected.length === 0 || selected.some((generalId) => !unlocked.has(generalId))) {
                throw new Error('INVALID_MATCH_GENERAL_SELECTION');
            }
            next[playerId] = { ...build, selectedGeneralIds: selected };
        }
        this.matchBuildSnapshots = next;
    }
    onTick(listener, options) {
        this.tickListeners.set(listener, options?.label ?? `tick-listener-${this.tickListeners.size + 1}`);
        this.performanceTelemetry?.setGauge('engine.tick.listeners', this.tickListeners.size);
        return () => {
            this.tickListeners.delete(listener);
            this.performanceTelemetry?.setGauge('engine.tick.listeners', this.tickListeners.size);
        };
    }
    onActionQueued(listener) {
        this.actionListeners.add(listener);
        this.performanceTelemetry?.setGauge('engine.action.listeners', this.actionListeners.size);
        return () => {
            this.actionListeners.delete(listener);
            this.performanceTelemetry?.setGauge('engine.action.listeners', this.actionListeners.size);
        };
    }
    onPveActionApplied(listener) {
        this.pveActionAppliedListeners.add(listener);
        return () => this.pveActionAppliedListeners.delete(listener);
    }
    enqueueDurableAction(input) {
        return this.enqueueAction(input.player, input.action, input.requestId, input.rateLimitRemaining, input.actionId);
    }
    exportPveCheckpointPayload() {
        if (!this.pveStarted || !this.state.pve?.configSnapshot)
            throw new Error('PVE_CHECKPOINT_MATCH_NOT_RUNNING');
        const state = structuredClone(this.state);
        state.logs = [];
        if (state.pve)
            state.pve.recentEvents = [];
        return {
            schemaVersion: 1,
            roomId: this.roomId,
            state,
            pveStarted: this.pveStarted,
            matchSequence: this.matchSequence,
            playerSlots: [...this.playerSlots.entries()].sort(([left], [right]) => left.localeCompare(right)),
            matchBuildSnapshots: structuredClone(this.matchBuildSnapshots),
            actionSequence: this.actionSequence,
            actionRequestReceipts: [...this.actionRequestReceipts.entries()].sort(([left], [right]) => left.localeCompare(right)),
            lastPveWaveNumber: this.lastPveWaveNumber,
            pveWaveStartedAtTick: this.pveWaveStartedAtTick,
            activeSlots: [...this.activeSlots],
            playerCount: this.playerCount,
            maxCapacity: this.maxCapacity,
            overloadTicks: this.overloadTicks,
            runtime: this.pveRuntime.exportCheckpoint(),
        };
    }
    restorePveCheckpointPayload(raw) {
        const checkpoint = structuredClone(raw);
        if (checkpoint.schemaVersion !== 1 || checkpoint.roomId !== this.roomId || !checkpoint.pveStarted
            || !checkpoint.state?.pve?.configSnapshot)
            throw new Error('PVE_ENGINE_CHECKPOINT_INVALID');
        this.actionQueue.drain();
        this.matchSequence = checkpoint.matchSequence;
        this.matchBuildSnapshots = structuredClone(checkpoint.matchBuildSnapshots);
        this.playerSlots.clear();
        for (const [playerId, slot] of checkpoint.playerSlots)
            this.playerSlots.set(playerId, slot);
        this.actionSequence = checkpoint.actionSequence;
        this.actionRequestReceipts.clear();
        for (const [key, receipt] of checkpoint.actionRequestReceipts)
            this.actionRequestReceipts.set(key, structuredClone(receipt));
        this.lastPveWaveNumber = checkpoint.lastPveWaveNumber;
        this.pveWaveStartedAtTick = checkpoint.pveWaveStartedAtTick;
        this.activeSlots = normalizeActiveSlots(checkpoint.activeSlots);
        this.playerCount = checkpoint.playerCount;
        this.maxCapacity = checkpoint.maxCapacity;
        this.overloadTicks = checkpoint.overloadTicks;
        const configSnapshot = checkpoint.state.pve.configSnapshot;
        this.pveRuntime = this.createPveRuntime(configSnapshot.levelId, configSnapshot.difficulty);
        this.pveRuntime.restoreCheckpoint(checkpoint.runtime);
        this.pveStarted = true;
        Object.assign(this.state, structuredClone(checkpoint.state), { pendingActions: 0, logs: [] });
        this.syncPveRuntimeState();
    }
    discardRecoveredPresentationEvents() {
        this.pveRuntime.discardPresentationEvents();
        this.syncPveRuntimeState();
    }
    applyRecoveredActions() {
        this.processQueuedActions();
        this.syncRuntimeState();
        this.discardRecoveredPresentationEvents();
    }
    getStateSnapshot() {
        this.syncRuntimeState();
        return this.cloneStateSnapshot();
    }
    isMatchFinished() {
        this.syncRuntimeState();
        return this.state.status === 'finished';
    }
    resetForRematch() {
        if (!this.isMatchFinished()) {
            return false;
        }
        this.matchSequence += 1;
        this.actionQueue.drain();
        this.pveRuntime = this.createPveRuntime();
        for (const [playerId, slotId] of this.playerSlots.entries()) {
            const build = this.matchBuildSnapshots[playerId];
            this.pveRuntime.registerPlayer(playerId, slotId, this.resolvePveGeneralSelection(build));
        }
        this.pveStarted = false;
        this.actionSequence = 0;
        this.actionRequestReceipts.clear();
        this.lastPveWaveNumber = 0;
        this.pveWaveStartedAtTick = 0;
        this.overloadTicks = 0;
        this.maxCapacity = this.playerCount * 10;
        this.state.matchId = `${this.config.matchId}:rematch-${this.matchSequence}`;
        this.state.tick = 0;
        this.state.startedAt = Date.now();
        this.state.status = 'waiting';
        this.state.result = null;
        this.state.playerCount = this.playerCount;
        this.state.maxCapacity = this.maxCapacity;
        this.state.overloadTicks = 0;
        this.state.overloadCountdownSec = 0;
        this.state.base.hp = this.state.base.maxHp;
        this.state.wave = {
            index: 0,
            label: '无波次',
            startedAtTick: 0,
            endsAtTick: null,
            remainingSpawns: 0,
            prepCountdownSec: 0,
        };
        this.state.enemies = [];
        this.state.towers = [];
        this.state.pendingActions = 0;
        this.state.logs = [];
        this.state.pve = this.projectPveSnapshot(this.pveRuntime.snapshot());
        for (const player of this.state.players) {
            player.gold = this.config.playerStartingGold;
            player.score = 0;
            player.lastActionAt = null;
        }
        this.syncMapCells();
        this.appendLog('info', 'GameEngine reset for rematch', {
            roomId: this.roomId,
            matchId: this.state.matchId,
            playerCount: this.playerCount,
        });
        return true;
    }
    tick() {
        const tickStartedAt = node_perf_hooks_1.performance.now();
        try {
            this.state.tick += 1;
            this.processQueuedActions();
            if (this.pveStarted) {
                if (this.state.status !== 'finished') {
                    this.pveRuntime.tick();
                }
                this.syncRuntimeState();
                this.state.pendingActions = this.actionQueue.size();
                if (this.state.tick % 10 === 0) {
                    this.appendLog('info', 'PVE V2 tick settled', {
                        tick: this.state.tick,
                        runtimeTick: this.state.pve?.tick,
                        players: this.state.pve?.players.length ?? 0,
                        enemies: this.state.pve?.enemyCount ?? 0,
                        pendingActions: this.state.pendingActions,
                        maxCapacity: this.state.maxCapacity,
                    });
                }
                this.emitTick(this.cloneStateSnapshot());
                return;
            }
            if (this.state.status === 'finished') {
                this.syncRuntimeState();
                this.state.pendingActions = this.actionQueue.size();
                this.emitTick(this.cloneStateSnapshot());
                return;
            }
            // PVE V2 is the only enabled PVE runtime. A pre-ignition engine only
            // broadcasts its waiting/finished shell and never runs legacy waves.
            this.syncRuntimeState();
            this.state.pendingActions = this.actionQueue.size();
            if (this.state.tick % 10 === 0) {
                this.appendLog('info', 'Tick settled', {
                    tick: this.state.tick,
                    players: this.state.players.length,
                    runtime: 'pve-v2',
                    pendingActions: this.state.pendingActions,
                    overloadTicks: this.overloadTicks,
                    maxCapacity: this.maxCapacity,
                });
            }
            this.emitTick(this.cloneStateSnapshot());
        }
        finally {
            this.performanceTelemetry?.recordDuration('engine.tick.total', node_perf_hooks_1.performance.now() - tickStartedAt);
            this.performanceTelemetry?.maybeReport({ tick: this.state.tick });
        }
    }
    emitTick(snapshot) {
        for (const [listener, label] of this.tickListeners.entries()) {
            const listenerStartedAt = node_perf_hooks_1.performance.now();
            try {
                listener(snapshot);
            }
            finally {
                this.performanceTelemetry?.recordDuration(`engine.listener.${label}`, node_perf_hooks_1.performance.now() - listenerStartedAt);
            }
        }
    }
    processQueuedActions() {
        const queuedActions = this.actionQueue.drain();
        if (queuedActions.length === 0) {
            return;
        }
        for (const queuedAction of queuedActions) {
            this.handleAction(queuedAction);
        }
    }
    handleAction(queuedAction) {
        if (this.state.status === 'finished') {
            this.appendLog('warn', 'Action ignored because match is already finished', {
                playerId: queuedAction.player.playerId,
                action: queuedAction.action.action,
            });
            return;
        }
        switch (queuedAction.action.action) {
            case 'BUILD_TOWER':
            case 'UPGRADE_TOWER':
            case 'SELL_TOWER':
                this.appendLog('warn', 'Legacy tower action rejected; PVE V2 uses soldier/general actions', {
                    playerId: queuedAction.player.playerId,
                    action: queuedAction.action.action,
                });
                return;
            case 'RECRUIT_BATCH':
            case 'DEPLOY_TRAY_PIECE':
            case 'MOVE_BOARD_PIECE':
            case 'MERGE_SOLDIERS':
            case 'SWAP_RESERVE_BOARD':
            case 'EXILE_RESERVE':
            case 'SWAP_STORAGE_PIECES':
            case 'SET_GENERAL_FIXED':
            case 'MOVE_FIXED_GENERAL':
            case 'USE_ACTIVE_ITEM':
            case 'SET_TUTORIAL_PAUSED':
                this.handlePveAction(queuedAction);
                return;
        }
    }
    handlePveAction(queuedAction) {
        const runtimeAction = this.toPveRuntimeAction(queuedAction);
        if (!runtimeAction) {
            this.appendLog('warn', 'PVE V2 action could not be translated', {
                playerId: queuedAction.player.playerId,
                action: queuedAction.action.action,
            });
            return;
        }
        const result = this.pveRuntime.handleAction(queuedAction.player.playerId, runtimeAction);
        this.appendLog(result.ok ? 'info' : 'warn', result.ok ? 'PVE V2 action applied' : 'PVE V2 action rejected', {
            playerId: queuedAction.player.playerId,
            action: queuedAction.action.action,
            actionId: queuedAction.id,
            resultCode: result.code,
        });
        for (const listener of this.pveActionAppliedListeners)
            listener(structuredClone(queuedAction), structuredClone(result));
    }
    toPveRuntimeAction(queuedAction) {
        const action = queuedAction.action;
        switch (action.action) {
            case 'RECRUIT_BATCH':
                return {
                    type: 'RECRUIT_BATCH',
                    actionId: queuedAction.id,
                    expectedTrayRevision: action.expectedTrayRevision,
                };
            case 'DEPLOY_TRAY_PIECE':
                return {
                    type: 'SWAP_TRAY_BOARD',
                    actionId: queuedAction.id,
                    trayIndex: action.trayIndex,
                    boardX: action.x,
                    boardY: action.y,
                    expectedTrayRevision: action.expectedTrayRevision,
                    expectedBoardRevision: action.expectedBoardRevision,
                };
            case 'SWAP_RESERVE_BOARD':
                return {
                    type: 'SWAP_RESERVE_BOARD',
                    actionId: queuedAction.id,
                    reserveIndex: action.reserveIndex,
                    boardX: action.x,
                    boardY: action.y,
                    expectedReserveRevision: action.expectedReserveRevision,
                    expectedBoardRevision: action.expectedBoardRevision,
                };
            case 'EXILE_RESERVE':
                return {
                    type: 'EXILE_RESERVE',
                    actionId: queuedAction.id,
                    expectedReserveRevision: action.expectedReserveRevision,
                };
            case 'SWAP_STORAGE_PIECES':
                return {
                    type: 'SWAP_STORAGE_PIECES',
                    actionId: queuedAction.id,
                    sourceZone: action.sourceZone,
                    sourceIndex: action.sourceIndex,
                    targetZone: action.targetZone,
                    targetIndex: action.targetIndex,
                    expectedTrayRevision: action.expectedTrayRevision,
                    expectedReserveRevision: action.expectedReserveRevision,
                };
            case 'MOVE_BOARD_PIECE':
                return {
                    type: 'MOVE_BOARD_PIECE',
                    actionId: queuedAction.id,
                    pieceId: action.entityId,
                    targetX: action.x,
                    targetY: action.y,
                    expectedBoardRevision: action.expectedBoardRevision,
                };
            case 'MERGE_SOLDIERS':
                return {
                    type: 'MERGE_SOLDIERS',
                    actionId: queuedAction.id,
                    sourcePieceId: action.sourceEntityId,
                    targetPieceId: action.targetEntityId,
                    expectedTrayRevision: action.expectedTrayRevision,
                    expectedBoardRevision: action.expectedBoardRevision,
                    expectedReserveRevision: action.expectedReserveRevision,
                };
            case 'SET_GENERAL_FIXED':
                return {
                    type: 'SET_GENERAL_FIXED',
                    actionId: queuedAction.id,
                    formationId: action.formationId,
                    fixed: action.fixed,
                    expectedBoardRevision: action.expectedBoardRevision,
                };
            case 'MOVE_FIXED_GENERAL':
                return {
                    type: 'MOVE_FIXED_GENERAL',
                    actionId: queuedAction.id,
                    formationId: action.formationId,
                    targetStartX: action.x,
                    targetStartY: action.y,
                    expectedBoardRevision: action.expectedBoardRevision,
                };
            case 'USE_ACTIVE_ITEM':
                return {
                    type: 'USE_ACTIVE_ITEM',
                    actionId: queuedAction.id,
                    requestId: queuedAction.clientRequestId ?? queuedAction.id,
                    slotIndex: action.slotIndex,
                    itemId: action.itemId,
                    target: action.target,
                    expectedItemRuntimeVersion: action.expectedItemRuntimeVersion,
                };
            case 'SET_TUTORIAL_PAUSED':
                return {
                    type: 'SET_TUTORIAL_PAUSED',
                    actionId: queuedAction.id,
                    paused: action.paused,
                };
            default:
                return null;
        }
    }
    registerPvePlayer(playerId) {
        const slot = this.playerSlots.get(playerId);
        if (!slot) {
            return;
        }
        const build = this.matchBuildSnapshots[playerId];
        this.pveRuntime.registerPlayer(playerId, slot, this.resolvePveGeneralSelection(build));
        this.syncPveRuntimeState();
    }
    /**
     * Never fall back to the complete hero catalog for a live PVE match.  A
     * missing account snapshot can happen during degraded startup/recovery; the
     * safe fallback is the immutable starter roster, otherwise locked hero
     * glyphs could leak into the summon pool.
     */
    resolvePveGeneralSelection(build) {
        const unlocked = build?.unlockedGeneralIds?.filter((id) => typeof id === 'string' && Boolean(hero_v1_1.GENERAL_CATALOG[id])) ?? [];
        const selected = build?.selectedGeneralIds?.filter((id) => typeof id === 'string' && unlocked.includes(id)) ?? [];
        if (unlocked.length > 0 && selected.length > 0) {
            return {
                unlockedGeneralIds: [...new Set(unlocked)].sort(),
                selectedGeneralIds: [...new Set(selected)].sort(),
            };
        }
        return {
            unlockedGeneralIds: [...service_1.DEFAULT_STARTER_GENERAL_IDS],
            selectedGeneralIds: [...service_1.DEFAULT_STARTER_GENERAL_IDS],
        };
    }
    createPveRuntime(levelId, difficulty = 'easy') {
        const seedSuffix = this.matchSequence > 0 ? `:rematch-${this.matchSequence}` : '';
        const stageDefinition = levelId === undefined ? null : (0, pve_stage_config_1.getPveStageDefinition)(levelId);
        const characterTokens = Object.values(hero_v1_1.GENERAL_CATALOG).flatMap((definition) => definition.recipe.glyphs)
            .reduce((counts, glyph) => {
            counts[glyph] = (counts[glyph] ?? 0) + 1;
            return counts;
        }, {});
        const itemLoadoutSnapshots = {};
        const weaponLoadoutSnapshots = {};
        for (const [playerId, build] of Object.entries(this.matchBuildSnapshots)) {
            itemLoadoutSnapshots[playerId] = {
                snapshotVersion: 1,
                catalogVersion: 1,
                playerId,
                accountVersion: build.item.accountVersion,
                activeSlots: build.item.activeSlots,
                passiveSlots: build.item.passiveSlots,
                activeItems: build.item.resolvedActiveDefinitions,
                passiveItems: build.item.resolvedPassiveDefinitions,
            };
            weaponLoadoutSnapshots[playerId] = {
                snapshotVersion: 1,
                playerId,
                accountVersion: build.weapon.accountVersion,
                byGeneralId: build.weapon.byGeneralId,
            };
        }
        return new pve_v2_1.PveGameRuntime({
            seed: `${this.config.matchId}:pve-v2${seedSuffix}`,
            levelId: levelId ?? 1,
            difficulty,
            tickRateMs: this.config.tickRateMs,
            prepDurationMs: pve_v2_1.PVE_WAVE_PREP_DURATION_MS,
            // First-time players receive a protected preparation window long enough
            // to recruit, deploy, and use an active item before enemies spawn.
            tutorialPrepDurationMs: 30_000,
            laneRoutes: createPveLaneRouteSnapshots(this.laneRoutes),
            maxWaves: 20,
            initialWaveNumber: this.config.pveInitialWaveNumber,
            characterTokens,
            waveGlyphPools: stageDefinition?.waveGlyphPools,
            itemLoadoutSnapshots,
            weaponLoadoutSnapshots,
            generalSelections: Object.fromEntries(Object.entries(this.matchBuildSnapshots)
                .filter(([, build]) => build.unlockedGeneralIds && build.selectedGeneralIds)
                .map(([playerId, build]) => [playerId, {
                    unlockedGeneralIds: build.unlockedGeneralIds,
                    selectedGeneralIds: build.selectedGeneralIds,
                }])),
        });
    }
    projectPveSnapshot(snapshot) {
        const formationByPieceId = new Map(snapshot.players.flatMap((player) => (player.generalFormations.flatMap((formation) => formation.characterPieceIds.map((pieceId) => [
            pieceId,
            formation,
        ])))));
        const generalProgressByOwnerAndId = new Map(snapshot.players.flatMap((player) => (player.generalProgress.map((progress) => [
            `${player.playerId}:${progress.generalId}`,
            progress,
        ]))));
        const players = snapshot.players.map((player) => ({
            playerId: player.playerId,
            slotId: player.slot,
            rice: player.rice,
            recruitSequence: player.recruitCount,
            nextRecruitCost: player.nextRecruitCost,
            populationUsed: player.populationUsed,
            populationCap: player.populationCap,
            trayRevision: player.trayRevision,
            reserveRevision: player.reserveRevision,
            boardRevision: player.boardRevision,
            tray: player.tray.map((piece, index) => ({
                index,
                piece: piece
                    ? {
                        entityId: piece.id,
                        kind: piece.kind,
                        glyph: piece.kind === 'character' ? piece.glyph : this.getSoldierGlyph(piece.soldierType),
                        ...(piece.kind === 'soldier'
                            ? { soldierType: piece.soldierType, level: piece.level }
                            : {}),
                    }
                    : null,
            })),
            reserve: player.reserve.map((piece, index) => ({
                index,
                piece: piece
                    ? {
                        entityId: piece.id,
                        kind: piece.kind,
                        glyph: piece.kind === 'character' ? piece.glyph : this.getSoldierGlyph(piece.soldierType),
                        ...(piece.kind === 'soldier'
                            ? { soldierType: piece.soldierType, level: piece.level }
                            : {}),
                    }
                    : null,
            })),
            discardedCharacters: player.discardedCharacters.map((piece) => ({
                entityId: piece.id,
                glyph: piece.glyph,
                createdSequence: piece.createdSequence,
            })),
            itemRuntime: player.itemRuntime ? {
                version: player.itemRuntime.version,
                slots: player.itemRuntime.slots.map((slot) => slot ? { ...slot } : null),
            } : null,
            weaponLoadoutByGeneralId: structuredClone(player.weaponLoadoutByGeneralId),
            generalFormations: player.generalFormations.map((formation) => ({
                formationId: formation.formationId,
                generalId: formation.generalId,
                name: formation.name,
                characterEntityIds: [...formation.characterPieceIds],
                cells: formation.cells.map((cell) => ({ ...cell })),
                anchor: { x: formation.anchorXMilli / 1000, y: formation.anchorYMilli / 1000 },
                fixed: formation.fixed,
            })),
            generalProgress: player.generalProgress.map((progress) => ({ ...progress })),
            activeSynergies: player.activeSynergies.map((synergy) => ({
                ...synergy,
                contributingGeneralIds: [...synergy.contributingGeneralIds],
            })),
            clearedWaves: [...player.clearedWaves],
            highestCompletedWave: player.clearedWaves.length > 0 ? Math.max(...player.clearedWaves) : 0,
            unlockedGeneralIds: [...player.unlockedGeneralIds],
            selectedGeneralIds: [...player.selectedGeneralIds],
        }));
        const boardPieces = snapshot.players.flatMap((player) => player.boardPieces.map(({ piece, x, y }) => {
            const formation = formationByPieceId.get(piece.id);
            return {
                entityId: piece.id,
                ownerPlayerId: piece.ownerPlayerId,
                kind: piece.kind,
                glyph: piece.kind === 'character' ? piece.glyph : this.getSoldierGlyph(piece.soldierType),
                ...(piece.kind === 'soldier'
                    ? {
                        soldierType: piece.soldierType,
                        level: piece.level,
                        nextAttackTick: piece.nextAttackTick,
                    }
                    : formation
                        ? {
                            formationId: formation.formationId,
                            generalId: formation.generalId,
                            generalName: formation.name,
                            generalQuality: generalProgressByOwnerAndId.get(`${piece.ownerPlayerId}:${formation.generalId}`)?.quality,
                            generalArchetype: generalProgressByOwnerAndId.get(`${piece.ownerPlayerId}:${formation.generalId}`)?.archetype,
                            generalFixed: formation.fixed,
                        }
                        : {}),
                x,
                y,
            };
        }));
        const enemies = snapshot.enemies.map((enemy) => {
            const loopStartIndex = this.laneRoutes[enemy.laneSlot]?.loopStartIndex ?? 0;
            return projectPveEnemySnapshot(enemy, loopStartIndex);
        });
        const spawningCompleted = snapshot.wave.phase === 'clearing'
            || snapshot.wave.phase === 'complete';
        return {
            schemaVersion: 2,
            combatRulesetVersion: snapshot.combatRulesetVersion,
            configSnapshot: structuredClone(snapshot.configSnapshot),
            phase: snapshot.status,
            tutorialPaused: snapshot.tutorialPaused,
            tick: snapshot.tick,
            players,
            boardPieces,
            enemies,
            statuses: snapshot.statuses.map((status) => ({ ...status })),
            summonedUnits: snapshot.summonedUnits.map((summon) => ({
                entityId: summon.id,
                ownerPlayerId: summon.ownerPlayerId,
                sourceGeneralId: summon.sourceGeneralId,
                sourceFormationId: summon.sourceFormationId,
                summonUnitId: summon.summonUnitId,
                glyph: summon.glyph,
                ownerLevel: summon.ownerLevel,
                nextAttackTick: summon.nextAttackTick,
                expiresAtTick: summon.expiresAtTick,
                x: summon.xMilli / 1000,
                y: summon.yMilli / 1000,
            })),
            zones: snapshot.zones.map((zone) => ({
                entityId: zone.id,
                ownerPlayerId: zone.ownerPlayerId,
                sourceGeneralId: zone.sourceGeneralId,
                sourceFormationId: zone.sourceFormationId,
                effectId: zone.effectId,
                zoneId: zone.zoneId,
                shape: { ...zone.shape },
                nextTick: zone.nextTick,
                expiresAtTick: zone.expiresAtTick,
                x: zone.xMilli / 1000,
                y: zone.yMilli / 1000,
            })),
            recentEvents: snapshot.recentEvents.map((event) => structuredClone(event)),
            laneWaves: snapshot.wave.lanes.map((lane) => ({
                playerId: lane.playerId,
                slotId: lane.slot,
                waveNumber: snapshot.wave.number,
                plannedSpawnCount: lane.totalCount + (lane.bossRequired ? 1 : 0),
                spawnedCount: lane.spawnedCount + (lane.bossSpawned ? 1 : 0),
                aliveEnemyCount: snapshot.enemies.filter((enemy) => (enemy.laneOwnerPlayerId === lane.playerId
                    && enemy.waveNumber === snapshot.wave.number)).length,
                spawningCompleted: spawningCompleted || (lane.spawnedCount >= lane.totalCount
                    && (!lane.bossRequired || lane.bossSpawned)),
                clearRewardRice: (0, pve_v2_1.resolvePveLaneClearRiceReward)(snapshot.wave.number),
                clearRewardGranted: lane.clearRewardGranted,
            })),
            currentWave: snapshot.wave.number,
            maxWaves: snapshot.wave.maxWaves,
            enemyCount: snapshot.enemies.length,
            maxCapacity: snapshot.enemyCapacity,
            overloadCountdownSec: Math.ceil(snapshot.overloadCountdownMs / 1000),
        };
    }
    getSoldierGlyph(soldierType) {
        switch (soldierType) {
            case 'blade': return '刀';
            case 'spear': return '枪';
            case 'bow': return '弓';
            case 'cavalry': return '骑';
        }
    }
    syncPveRuntimeState() {
        const snapshot = this.pveRuntime.snapshot();
        this.state.pve = this.projectPveSnapshot(snapshot);
        if (!this.pveStarted) {
            return;
        }
        this.playerCount = Math.max(1, snapshot.playerCountAtStart || snapshot.players.length);
        this.maxCapacity = snapshot.enemyCapacity;
        this.overloadTicks = snapshot.overloadTicks;
        this.state.playerCount = this.playerCount;
        this.state.maxCapacity = this.maxCapacity;
        this.state.overloadTicks = this.overloadTicks;
        this.state.overloadCountdownSec = Math.ceil(snapshot.overloadCountdownMs / 1000);
        if (snapshot.wave.number !== this.lastPveWaveNumber) {
            this.lastPveWaveNumber = snapshot.wave.number;
            this.pveWaveStartedAtTick = this.state.tick;
        }
        const phaseLabels = {
            idle: '等待中',
            prep: '准备中',
            spawning: '出怪中',
            clearing: '清场中',
            complete: '已完成',
        };
        this.state.wave = {
            index: snapshot.wave.number,
            label: snapshot.wave.number > 0
                ? `第 ${snapshot.wave.number} 波 · ${phaseLabels[snapshot.wave.phase]}`
                : phaseLabels[snapshot.wave.phase],
            startedAtTick: this.pveWaveStartedAtTick,
            endsAtTick: snapshot.wave.phase === 'complete' ? this.state.tick : null,
            remainingSpawns: snapshot.wave.lanes.reduce((total, lane) => total + Math.max(0, lane.totalCount - lane.spawnedCount), 0),
            prepCountdownSec: Math.ceil(snapshot.wave.prepRemainingTicks * this.config.tickRateMs / 1000),
        };
        for (const legacyPlayer of this.state.players) {
            const runtimePlayer = snapshot.players.find((player) => player.playerId === legacyPlayer.id);
            if (runtimePlayer) {
                legacyPlayer.gold = runtimePlayer.rice;
            }
        }
        this.state.enemies = [];
        this.state.towers = [];
        this.state.status = snapshot.status;
        this.state.result = snapshot.result
            ? {
                outcome: snapshot.result.outcome,
                decidedAtTick: snapshot.result.decidedAtTick,
                reason: snapshot.result.reason,
            }
            : null;
    }
    ensurePlayer(identity) {
        let player = this.state.players.find((item) => item.id === identity.playerId);
        if (!player) {
            this.registerPlayer(identity);
            player = this.state.players.find((item) => item.id === identity.playerId);
        }
        if (!player) {
            throw new Error(`Player ${identity.playerId} could not be registered`);
        }
        return player;
    }
    appendLog(level, message, meta) {
        if (level === 'info' && !this.config.verboseGameLogs) {
            return;
        }
        const entry = {
            tick: this.state.tick,
            level,
            message,
            meta,
        };
        this.state.logs.push(entry);
        if (this.state.logs.length > 200) {
            this.state.logs.shift();
        }
    }
    syncMapCells() {
        this.state.map.cells = this.gridMap.toCells();
    }
    syncRuntimeState() {
        this.syncPveRuntimeState();
    }
    cloneStateSnapshot() {
        return structuredClone(this.state);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 关卡点火（由 Room/SocketGateway 在玩家选择难度后调用）
    // ─────────────────────────────────────────────────────────────────────────
    /** 新版唯一公开点火入口；只接受 PVE V2 关卡身份，不接受 legacy 波次配置。 */
    ignitePveV2(levelId, difficulty) {
        if (this.state.status !== 'waiting') {
            // 防止重复点火
            return;
        }
        this.overloadTicks = 0;
        this.syncMapCells();
        this.pveRuntime = this.createPveRuntime(levelId, difficulty);
        for (const [playerId, slotId] of this.playerSlots.entries()) {
            const build = this.matchBuildSnapshots[playerId];
            this.pveRuntime.registerPlayer(playerId, slotId, this.resolvePveGeneralSelection(build));
        }
        this.pveStarted = true;
        this.pveRuntime.start();
        this.syncPveRuntimeState();
        this.appendLog('info', 'Engine ignited with PVE V2 runtime', {
            runtimeKind: 'pve-v2',
            combatRulesetVersion: this.state.pve?.combatRulesetVersion ?? null,
            selectedLevelId: levelId,
            selectedDifficulty: difficulty,
            runtimeMaxWaves: 20,
            playerCount: this.playerCount,
        });
    }
}
exports.GameEngine = GameEngine;
