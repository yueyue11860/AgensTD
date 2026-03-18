"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEngine = void 0;
const action_queue_1 = require("./action-queue");
const enemy_factory_1 = require("./enemy-factory");
const tower_builder_1 = require("./tower-builder");
const grid_map_1 = require("./grid-map");
const WaveManager_1 = require("./WaveManager");
const node_perf_hooks_1 = require("node:perf_hooks");
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
            spawn: clonePosition(arena_layout_1.WAYPOINTS_MAP.P1[0]),
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P1),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P1),
        },
        P2: {
            slot: 'P2',
            spawn: clonePosition(arena_layout_1.WAYPOINTS_MAP.P2[0]),
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P2),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P2),
        },
        P3: {
            slot: 'P3',
            spawn: clonePosition(arena_layout_1.WAYPOINTS_MAP.P3[0]),
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P3),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P3),
        },
        P4: {
            slot: 'P4',
            spawn: clonePosition(arena_layout_1.WAYPOINTS_MAP.P4[0]),
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P4),
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
            },
            players: [],
            enemies: [],
            towers: [],
            pendingActions: 0,
            logs: [],
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
        this.maxCapacity = this.playerCount * 10;
        this.waveManager.setSpawnMultiplier(this.playerCount);
        this.state.playerCount = this.playerCount;
        this.state.maxCapacity = this.maxCapacity;
    }
    setActiveSlots(activeSlots) {
        this.activeSlots = normalizeActiveSlots(activeSlots);
        this.spawnRotation = 0;
    }
    enqueueAction(player, action) {
        const queuedAction = {
            id: `${player.playerId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
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
    tick() {
        const tickStartedAt = node_perf_hooks_1.performance.now();
        try {
            this.state.tick += 1;
            this.processQueuedActions();
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
            };
            return;
        }
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
        };
    }
    evaluateOverloadState() {
        if (this.enemies.length >= this.maxCapacity) {
            this.overloadTicks += 1;
        }
        else if (this.overloadTicks > 0) {
            this.overloadTicks = 0;
        }
        this.state.overloadTicks = this.overloadTicks;
        this.state.maxCapacity = this.maxCapacity;
        this.state.playerCount = this.playerCount;
        if (this.overloadTicks >= 100) {
            this.finishMatch('defeat', `Overload persisted for ${this.overloadTicks} ticks`);
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
     * 使用指定波次配置重建 WaveManager 并将引擎切换至 'running'。
     *
     * @param waves        来自 LevelConfig 的波次列表
     * @param startingGold 覆盖初始金币（用于 L0 教学关等特殊配置）
     */
    ignite(waves, startingGold) {
        if (this.state.status !== 'waiting') {
            // 防止重复点火
            return;
        }
        this.waveManager = this.createWaveManager(waves, this.playerCount);
        if (startingGold !== undefined) {
            for (const player of this.state.players) {
                player.gold = startingGold;
            }
        }
        this.state.status = 'running';
        this.appendLog('info', 'Engine ignited', {
            waveCount: waves.length,
            startingGold,
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
