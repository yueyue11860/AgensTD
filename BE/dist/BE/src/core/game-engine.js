"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEngine = void 0;
const action_queue_1 = require("./action-queue");
const enemy_factory_1 = require("./enemy-factory");
const tower_builder_1 = require("./tower-builder");
const grid_map_1 = require("./grid-map");
const WaveManager_1 = require("./WaveManager");
const node_perf_hooks_1 = require("node:perf_hooks");
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
class GameEngine {
    config;
    roomId;
    actionQueue = new action_queue_1.ActionQueue();
    tickListeners = new Map();
    actionListeners = new Set();
    enemyFactory = new enemy_factory_1.EnemyFactory();
    state;
    gridMap;
    enemies = [];
    towers = [];
    // 非 readonly：ignite() 时会用新波次配置重建 WaveManager
    waveManager;
    laneRoutes;
    pveRuntime;
    matchSequence = 0;
    playerSlots = new Map();
    pveStarted = false;
    actionSequence = 0;
    lastPveWaveNumber = 0;
    pveWaveStartedAtTick = 0;
    activeSlots;
    playerCount;
    maxCapacity;
    overloadTicks = 0;
    spawnRotation = 0;
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
        this.waveManager = this.createWaveManager(config.waveConfigs, options.spawnMultiplier ?? this.playerCount);
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
        this.updateWaveState();
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
    setPlayerCount(playerCount) {
        this.playerCount = normalizePlayerCount(playerCount);
        if (this.pveStarted) {
            this.syncPveRuntimeState();
            return;
        }
        this.maxCapacity = this.playerCount * 10;
        this.waveManager.setSpawnMultiplier(this.playerCount);
        this.state.playerCount = this.playerCount;
        this.state.maxCapacity = this.maxCapacity;
    }
    setActiveSlots(activeSlots) {
        this.activeSlots = normalizeActiveSlots(activeSlots);
        this.spawnRotation = 0;
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
            this.pveRuntime.registerPlayer(playerId, slotId);
        }
        this.syncPveRuntimeState();
    }
    enqueueAction(player, action) {
        this.actionSequence += 1;
        const queuedAction = {
            id: `${player.playerId}:${this.actionSequence}`,
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
        return {
            actionId: queuedAction.id,
            serverTick: this.state.tick,
        };
    }
    attachPerformanceTelemetry(performanceTelemetry) {
        this.performanceTelemetry = performanceTelemetry;
        this.performanceTelemetry.setGauge('engine.tick.listeners', this.tickListeners.size);
        this.performanceTelemetry.setGauge('engine.action.listeners', this.actionListeners.size);
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
        for (const tower of this.towers) {
            this.gridMap.release(tower.x, tower.y, tower.width, tower.height);
        }
        this.towers = [];
        this.enemies = [];
        this.waveManager = this.createWaveManager(this.config.waveConfigs, this.playerCount);
        this.pveRuntime = this.createPveRuntime();
        for (const [playerId, slotId] of this.playerSlots.entries()) {
            this.pveRuntime.registerPlayer(playerId, slotId);
        }
        this.pveStarted = false;
        this.actionSequence = 0;
        this.lastPveWaveNumber = 0;
        this.pveWaveStartedAtTick = 0;
        this.overloadTicks = 0;
        this.maxCapacity = this.playerCount * 10;
        this.spawnRotation = 0;
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
                this.updateWaveState();
                this.syncRuntimeState();
                this.state.pendingActions = this.actionQueue.size();
                this.emitTick(this.cloneStateSnapshot());
                return;
            }
            // 等待关卡选择：持续向前端广播状态（建塔等操作已在 processQueuedActions 中处理），
            // 但不推进 WaveManager 刷怪逻辑。
            if (this.state.status === 'waiting') {
                this.syncRuntimeState();
                this.state.pendingActions = this.actionQueue.size();
                this.emitTick(this.cloneStateSnapshot());
                return;
            }
            this.resolveTowerAttacks();
            this.collectDefeatedEnemies();
            this.updateEnemyPositions(this.config.tickRateMs / 1000);
            this.collectDefeatedEnemies();
            this.waveManager.update();
            this.updateWaveState();
            this.evaluateOverloadState();
            this.syncRuntimeState();
            this.state.pendingActions = this.actionQueue.size();
            if (this.state.tick % 10 === 0) {
                this.appendLog('info', 'Tick settled', {
                    tick: this.state.tick,
                    players: this.state.players.length,
                    towers: this.towers.length,
                    enemies: this.enemies.length,
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
        if (this.pveStarted
            && (queuedAction.action.action === 'BUILD_TOWER'
                || queuedAction.action.action === 'UPGRADE_TOWER'
                || queuedAction.action.action === 'SELL_TOWER')) {
            this.appendLog('warn', 'Legacy tower action ignored after PVE V2 ignition', {
                playerId: queuedAction.player.playerId,
                action: queuedAction.action.action,
            });
            return;
        }
        switch (queuedAction.action.action) {
            case 'BUILD_TOWER':
                this.handleBuildTower(queuedAction);
                return;
            case 'UPGRADE_TOWER':
                this.handleUpgradeTower(queuedAction);
                return;
            case 'SELL_TOWER':
                this.appendLog('info', 'Sell action acknowledged but not implemented yet', {
                    playerId: queuedAction.player.playerId,
                    towerId: queuedAction.action.towerId,
                });
                return;
            case 'RECRUIT_BATCH':
            case 'DEPLOY_TRAY_PIECE':
            case 'MOVE_BOARD_PIECE':
            case 'MERGE_SOLDIERS':
            case 'SWAP_RESERVE_BOARD':
            case 'EXILE_RESERVE':
            case 'SWAP_STORAGE_PIECES':
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
            default:
                return null;
        }
    }
    handleBuildTower(queuedAction) {
        const player = this.ensurePlayer(queuedAction.player);
        const { x, y, type } = queuedAction.action;
        const stats = tower_builder_1.TowerBuilder.getConfigBySelection(type);
        if (!stats) {
            this.appendLog('warn', 'Unknown tower type rejected', { playerId: player.id, type });
            return;
        }
        if (!this.isValidBuildPlacement(x, y, stats.width, stats.height)) {
            this.appendLog('warn', 'Build rejected because coordinates are invalid', { playerId: player.id, x, y });
            return;
        }
        if (!this.gridMap.canBuildTower(x, y, stats.width, stats.height)) {
            this.appendLog('warn', 'Build rejected because placement is not on high ground', {
                playerId: player.id,
                x,
                y,
            });
            return;
        }
        if (player.gold < stats.cost) {
            this.appendLog('warn', 'Build rejected because player has insufficient gold', {
                playerId: player.id,
                gold: player.gold,
                requiredGold: stats.cost,
            });
            return;
        }
        player.gold -= stats.cost;
        const builtTower = tower_builder_1.TowerBuilder.createFromSelection(type, {
            ownerId: player.id,
            x,
            y,
            tick: this.state.tick,
            sequence: this.towers.length + 1,
        });
        if (!builtTower) {
            this.appendLog('warn', 'Tower builder failed to create tower', { playerId: player.id, type });
            player.gold += stats.cost;
            return;
        }
        this.towers.push(builtTower.tower);
        this.gridMap.occupy(x, y, stats.width, stats.height);
        this.syncMapCells();
        this.appendLog('info', 'Tower built', { playerId: player.id, towerId: builtTower.state.id, type, x, y });
    }
    handleUpgradeTower(queuedAction) {
        const player = this.ensurePlayer(queuedAction.player);
        const towerIndex = this.towers.findIndex((tower) => tower.id === queuedAction.action.towerId);
        if (towerIndex < 0) {
            this.appendLog('warn', 'Upgrade rejected because tower does not exist', {
                playerId: player.id,
                towerId: queuedAction.action.towerId,
            });
            return;
        }
        const currentTower = this.towers[towerIndex];
        if (currentTower.ownerId !== player.id) {
            this.appendLog('warn', 'Upgrade rejected because tower owner does not match player', {
                playerId: player.id,
                towerId: currentTower.id,
                ownerId: currentTower.ownerId,
            });
            return;
        }
        const currentConfig = tower_builder_1.TowerBuilder.getConfigBySelection(currentTower.type);
        const nextConfig = tower_builder_1.TowerBuilder.getNextConfigBySelection(currentTower.type);
        if (!currentConfig || !nextConfig) {
            this.appendLog('warn', 'Upgrade rejected because tower is already at max level', {
                playerId: player.id,
                towerId: currentTower.id,
                type: currentTower.type,
            });
            return;
        }
        if (player.gold < nextConfig.cost) {
            this.appendLog('warn', 'Upgrade rejected because player has insufficient gold', {
                playerId: player.id,
                towerId: currentTower.id,
                gold: player.gold,
                requiredGold: nextConfig.cost,
            });
            return;
        }
        if (!this.canUpgradeTowerFootprint(currentTower, nextConfig)) {
            this.appendLog('warn', 'Upgrade rejected because upgraded footprint would overlap invalid terrain', {
                playerId: player.id,
                towerId: currentTower.id,
                type: nextConfig.type,
            });
            return;
        }
        player.gold -= nextConfig.cost;
        const upgradedTower = tower_builder_1.TowerBuilder.upgradeTower(currentTower, nextConfig);
        this.towers[towerIndex] = upgradedTower.tower;
        if (currentTower.width !== nextConfig.width || currentTower.height !== nextConfig.height) {
            this.gridMap.release(currentTower.x, currentTower.y, currentTower.width, currentTower.height);
            this.gridMap.occupy(currentTower.x, currentTower.y, nextConfig.width, nextConfig.height);
            this.syncMapCells();
        }
        this.appendLog('info', 'Tower upgraded', {
            playerId: player.id,
            towerId: currentTower.id,
            fromType: currentConfig.type,
            toType: nextConfig.type,
            cost: nextConfig.cost,
        });
    }
    resolveTowerAttacks() {
        for (const tower of this.towers) {
            tower.beginTick();
        }
        this.runTowerPhase('support');
        this.runTowerPhase('action');
    }
    runTowerPhase(phase) {
        for (const tower of this.towers) {
            if (tower.getPhase() !== phase) {
                continue;
            }
            const report = tower.tick({
                enemies: this.enemies,
                towers: this.towers,
                tickRateMs: this.config.tickRateMs,
            });
            for (const attack of report.attacks) {
                this.appendLog('info', 'Tower applied attack effect', {
                    towerId: tower.id,
                    enemyId: attack.enemyId,
                    damage: attack.damage,
                    mode: attack.mode,
                });
            }
            if (report.buffedTowerIds.length > 0) {
                this.appendLog('info', 'Tower applied support aura', {
                    towerId: tower.id,
                    buffedTowerIds: report.buffedTowerIds,
                });
            }
            if (report.grantedGold > 0) {
                const owner = this.state.players.find((player) => player.id === tower.ownerId);
                if (owner) {
                    owner.gold += report.grantedGold;
                }
                this.appendLog('info', 'Tower generated gold', {
                    towerId: tower.id,
                    ownerId: tower.ownerId,
                    goldGranted: report.grantedGold,
                });
            }
        }
    }
    collectDefeatedEnemies() {
        const defeatedEnemies = this.enemies.filter((enemy) => !enemy.isAlive());
        if (defeatedEnemies.length === 0) {
            return;
        }
        const defeatedEnemyIds = new Set(defeatedEnemies.map((enemy) => enemy.id));
        this.enemies = this.enemies.filter((enemy) => !defeatedEnemyIds.has(enemy.id));
        const splitSpawnQueue = [];
        for (const enemy of defeatedEnemies) {
            const owner = this.findRewardOwner(enemy);
            if (owner) {
                owner.gold += enemy.rewardGold;
                owner.score += enemy.rewardGold;
            }
            const routeState = enemy.getRouteState();
            const splitRequests = enemy.collectSplitOnDeathSpawns();
            for (const splitRequest of splitRequests) {
                splitSpawnQueue.push({
                    kind: splitRequest.kind,
                    count: splitRequest.count,
                    route: {
                        spawn: { x: enemy.x, y: enemy.y },
                        path: routeState.path,
                        pathIndex: routeState.pathIndex,
                        loopStartIndex: routeState.loopStartIndex,
                    },
                    sourceEnemyId: enemy.id,
                });
            }
            this.appendLog('info', 'Enemy defeated', { enemyId: enemy.id, rewardGold: enemy.rewardGold });
        }
        for (const splitSpawn of splitSpawnQueue) {
            for (let index = 0; index < splitSpawn.count; index += 1) {
                const splitEnemy = this.spawnEnemyByKind(splitSpawn.kind, null, `split:${splitSpawn.sourceEnemyId}`, splitSpawn.route);
                if (!splitEnemy) {
                    break;
                }
            }
        }
    }
    updateEnemyPositions(deltaTime) {
        for (const enemy of this.enemies) {
            enemy.updateEffects(deltaTime);
            if (!enemy.isAlive()) {
                continue;
            }
            enemy.move(deltaTime);
        }
    }
    registerPvePlayer(playerId) {
        const slot = this.playerSlots.get(playerId);
        if (!slot) {
            return;
        }
        this.pveRuntime.registerPlayer(playerId, slot);
        this.syncPveRuntimeState();
    }
    createPveRuntime() {
        const seedSuffix = this.matchSequence > 0 ? `:rematch-${this.matchSequence}` : '';
        return new pve_v2_1.PveGameRuntime({
            seed: `${this.config.matchId}:pve-v2${seedSuffix}`,
            tickRateMs: this.config.tickRateMs,
            laneRoutes: createPveLaneRouteSnapshots(this.laneRoutes),
            maxWaves: 20,
        });
    }
    projectPveSnapshot(snapshot) {
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
            highestCompletedWave: player.clearedWaves.length > 0 ? Math.max(...player.clearedWaves) : 0,
        }));
        const boardPieces = snapshot.players.flatMap((player) => player.boardPieces.map(({ piece, x, y }) => ({
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
                : {}),
            x,
            y,
        })));
        const enemies = snapshot.enemies.map((enemy) => {
            const loopStartIndex = this.laneRoutes[enemy.laneSlot]?.loopStartIndex ?? 0;
            return {
                entityId: enemy.id,
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
                invulnerable: (0, pve_v2_1.isInsidePveProtectedZoneMilli)(enemy.xMilli, enemy.yMilli),
                x: enemy.xMilli / 1000,
                y: enemy.yMilli / 1000,
            };
        });
        const spawningCompleted = snapshot.wave.phase === 'clearing'
            || snapshot.wave.phase === 'complete';
        return {
            schemaVersion: 2,
            phase: snapshot.status,
            tick: snapshot.tick,
            players,
            boardPieces,
            enemies,
            laneWaves: snapshot.wave.lanes.map((lane) => ({
                playerId: lane.playerId,
                slotId: lane.slot,
                waveNumber: snapshot.wave.number,
                plannedSpawnCount: lane.totalCount,
                spawnedCount: lane.spawnedCount,
                aliveEnemyCount: snapshot.enemies.filter((enemy) => (enemy.laneOwnerPlayerId === lane.playerId
                    && enemy.waveNumber === snapshot.wave.number)).length,
                spawningCompleted: spawningCompleted || lane.spawnedCount >= lane.totalCount,
                clearRewardRice: snapshot.wave.number * 5,
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
    isValidBuildPlacement(x, y, width, height) {
        for (let offsetY = 0; offsetY < height; offsetY += 1) {
            for (let offsetX = 0; offsetX < width; offsetX += 1) {
                const cell = this.gridMap.getCell(x + offsetX, y + offsetY);
                if (cell === null || !cell.buildable) {
                    return false;
                }
            }
        }
        return true;
    }
    canUpgradeTowerFootprint(currentTower, nextConfig) {
        if (currentTower.width === nextConfig.width && currentTower.height === nextConfig.height) {
            return true;
        }
        this.gridMap.release(currentTower.x, currentTower.y, currentTower.width, currentTower.height);
        try {
            return this.isValidBuildPlacement(currentTower.x, currentTower.y, nextConfig.width, nextConfig.height)
                && this.gridMap.canBuildTower(currentTower.x, currentTower.y, nextConfig.width, nextConfig.height);
        }
        finally {
            this.gridMap.occupy(currentTower.x, currentTower.y, currentTower.width, currentTower.height);
        }
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
    updateWaveState() {
        const snapshot = this.waveManager.getSnapshot();
        const currentWave = snapshot.currentWave;
        if (!currentWave) {
            this.state.wave = {
                index: 0,
                label: snapshot.victoryTriggered ? '已完成' : '无波次',
                startedAtTick: 0,
                endsAtTick: null,
                remainingSpawns: 0,
                prepCountdownSec: 0,
            };
            return;
        }
        const prepCountdownSec = snapshot.state === 'PREP'
            ? Math.ceil(snapshot.timer * this.config.tickRateMs / 1000)
            : 0;
        const phaseLabel = snapshot.state === 'PREP'
            ? '准备中'
            : snapshot.state === 'SPAWNING'
                ? '出怪中'
                : '清场中';
        this.state.wave = {
            index: currentWave.waveNumber,
            label: `第 ${currentWave.waveNumber} 波 · ${phaseLabel}`,
            startedAtTick: Math.max(0, this.state.tick - this.waveManager.getCurrentWaveElapsedTicks()),
            endsAtTick: null,
            remainingSpawns: snapshot.remainingSpawns,
            prepCountdownSec,
        };
    }
    evaluateOverloadState() {
        const isOverloaded = this.enemies.length >= this.maxCapacity;
        if (isOverloaded) {
            this.overloadTicks += 1;
        }
        else {
            this.overloadTicks = 0;
        }
        this.state.overloadTicks = this.overloadTicks;
        this.state.maxCapacity = this.maxCapacity;
        this.state.playerCount = this.playerCount;
        // 10 秒倒计时 = 10000ms / tickRateMs ticks
        const overloadLimitTicks = Math.ceil(10000 / this.config.tickRateMs);
        const remainingTicks = Math.max(0, overloadLimitTicks - this.overloadTicks);
        this.state.overloadCountdownSec = this.overloadTicks > 0
            ? Math.ceil(remainingTicks * this.config.tickRateMs / 1000)
            : 0;
        if (this.overloadTicks >= overloadLimitTicks) {
            this.finishMatch('defeat', `同屏怪物超载超过 10 秒`);
        }
    }
    finishMatch(outcome, reason) {
        if (this.state.status === 'finished') {
            return;
        }
        this.state.status = 'finished';
        this.state.result = {
            outcome,
            decidedAtTick: this.state.tick,
            reason,
        };
        this.appendLog('info', 'Match finished', {
            outcome,
            reason,
            tick: this.state.tick,
            overloadTicks: this.overloadTicks,
        });
    }
    getNextSpawnRoute() {
        const slot = this.activeSlots[this.spawnRotation % this.activeSlots.length] ?? 'P1';
        this.spawnRotation = (this.spawnRotation + 1) % Math.max(1, this.activeSlots.length);
        return this.laneRoutes[slot] ?? this.laneRoutes.P1;
    }
    spawnEnemyByKind(kind, waveIndex, waveLabel, route) {
        const enemy = this.enemyFactory.createByCode({
            id: `enemy-${kind}-${this.state.tick}-${this.enemies.length + 1}`,
            code: kind,
            spawn: route.spawn,
            path: route.path,
        });
        if (!enemy) {
            this.appendLog('warn', 'Enemy spawn skipped because kind is unknown', {
                kind,
                waveIndex,
            });
            return null;
        }
        enemy.setRoute(route.path, {
            pathIndex: route.pathIndex,
            loopStartIndex: route.loopStartIndex,
            position: route.spawn,
        });
        this.enemies.push(enemy);
        this.appendLog('info', 'Enemy spawned', {
            enemyId: enemy.id,
            kind: enemy.kind,
            waveIndex,
            waveLabel,
            x: enemy.x,
            y: enemy.y,
            loopStartIndex: route.loopStartIndex,
        });
        return enemy;
    }
    findRewardOwner(enemy) {
        if (enemy.lastDamagedByPlayerId) {
            const lastAttacker = this.state.players.find((player) => player.id === enemy.lastDamagedByPlayerId);
            if (lastAttacker) {
                return lastAttacker;
            }
        }
        return this.state.players[0];
    }
    syncRuntimeState() {
        this.syncPveRuntimeState();
        if (this.pveStarted) {
            return;
        }
        this.state.playerCount = this.playerCount;
        this.state.maxCapacity = this.maxCapacity;
        this.state.overloadTicks = this.overloadTicks;
        this.state.enemies = this.enemies.map((enemy) => enemy.toState());
        this.state.towers = this.towers.map((tower) => tower.toState());
    }
    cloneStateSnapshot() {
        return structuredClone(this.state);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 关卡点火（由 Room/SocketGateway 在玩家选择难度后调用）
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * 保留旧关卡选择入口，但点火后只启动 PVE V2 运行时。
     * 新版 PVE 关卡统一为二十波；旧 waves/startingGold 仅用于启动审计，
     * 不再驱动旧怪物、旧塔或覆盖新版初始斋饭。
     */
    ignite(waves, startingGold) {
        if (this.state.status !== 'waiting') {
            // 防止重复点火
            return;
        }
        for (const tower of this.towers) {
            this.gridMap.release(tower.x, tower.y, tower.width, tower.height);
        }
        this.towers = [];
        this.enemies = [];
        this.overloadTicks = 0;
        this.syncMapCells();
        this.pveStarted = true;
        this.pveRuntime.start();
        this.syncPveRuntimeState();
        this.appendLog('info', 'Engine ignited with PVE V2 runtime', {
            selectedLegacyWaveCount: waves.length,
            ignoredLegacyStartingGold: startingGold ?? null,
            runtimeMaxWaves: 20,
            playerCount: this.playerCount,
        });
    }
    /**
     * 构建 WaveManager 实例（供构造函数和 ignite() 共用）。
     * 回调闭包引用 `this`，因此新旧 WaveManager 切换后回调依然有效。
     */
    createWaveManager(waves, spawnMultiplier) {
        const callbacks = {
            onSpawn: (enemyType) => {
                if (this.state.status === 'finished') {
                    return;
                }
                const currentWave = this.waveManager.getCurrentWave();
                const route = this.getNextSpawnRoute();
                this.spawnEnemyByKind(enemyType, currentWave?.waveNumber ?? null, currentWave ? `第 ${currentWave.waveNumber} 波` : 'WaveManager', {
                    spawn: clonePosition(route.spawn),
                    path: clonePath(route.path),
                    pathIndex: 0,
                    loopStartIndex: route.loopStartIndex,
                });
            },
            isMapClear: () => this.enemies.length === 0,
            onVictory: () => {
                this.finishMatch('victory', 'All waves cleared');
            },
        };
        return new WaveManager_1.WaveManager(waves, callbacks, { spawnMultiplier });
    }
}
exports.GameEngine = GameEngine;
