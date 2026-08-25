"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomManager = exports.Room = exports.ROOM_SLOT_ORDER = void 0;
exports.createFixedRoomLayout = createFixedRoomLayout;
const arena_layout_1 = require("../config/arena-layout");
const grid_map_1 = require("./grid-map");
const game_engine_1 = require("./game-engine");
exports.ROOM_SLOT_ORDER = ['P1', 'P2', 'P3', 'P4'];
const MIN_ROOM_WIDTH = arena_layout_1.ARENA_GRID_SIZE;
const MIN_ROOM_HEIGHT = arena_layout_1.ARENA_GRID_SIZE;
const HUB = (0, arena_layout_1.getArenaPrimaryBasePoint)();
function createLaneRoutes(pathGrid) {
    function createLaneRoute(slot) {
        const spawn = (0, arena_layout_1.getArenaLaneSpawnPoint)(slot);
        const path = (0, arena_layout_1.createArenaEnemyLanePath)(slot);
        const loopStartIndex = (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP[slot]);
        return {
            slot,
            spawn,
            path,
            loopStartIndex,
        };
    }
    return {
        P1: createLaneRoute('P1'),
        P2: createLaneRoute('P2'),
        P3: createLaneRoute('P3'),
        P4: createLaneRoute('P4'),
    };
}
function createFixedRoomLayout(width, height) {
    if (width < MIN_ROOM_WIDTH || height < MIN_ROOM_HEIGHT) {
        throw new Error(`Arena room requires at least ${MIN_ROOM_WIDTH}x${MIN_ROOM_HEIGHT} cells`);
    }
    const cells = (0, arena_layout_1.createArenaMapCells)(width, height);
    const pathGrid = new grid_map_1.GridMap(cells, (0, arena_layout_1.getArenaPrimarySpawnPoint)(), HUB);
    const laneRoutes = createLaneRoutes(pathGrid);
    return {
        width,
        height,
        hub: { ...HUB },
        primarySpawn: { ...laneRoutes.P1.spawn },
        cells,
        laneRoutes,
    };
}
class Room {
    accountRuntime;
    id;
    layout;
    engine;
    slotAssignments = new Map();
    // 房间生命周期状态机
    phase = 'lobby';
    displayName;
    hasPassword;
    // 第一个加入的玩家为房主
    hostPlayerId = null;
    // 倒计时定时器句柄（idle 时务必清除）
    countdownTimer = null;
    countdownPreparing = false;
    pendingStageSelection = null;
    activeStageSelection = null;
    /**
     * 结算与奖励是异步执行的；按 matchId 保留关卡快照，避免玩家立即重开时
     * 把上一局的奖励写到新一局所选关卡。
     */
    stageSelectionsByMatchId = new Map();
    matchBuildSnapshots = new Map();
    constructor(id, config, options, accountRuntime) {
        this.accountRuntime = accountRuntime;
        this.id = id;
        this.displayName = options?.displayName?.trim() || id;
        this.hasPassword = options?.hasPassword ?? false;
        this.layout = createFixedRoomLayout(config.mapWidth, config.mapHeight);
        this.engine = new game_engine_1.GameEngine({
            ...config,
            matchId: `${config.matchId}:${id}`,
        }, {
            roomId: id,
            playerCount: 1,
            activeSlots: ['P1'],
            mapCells: this.layout.cells,
            laneRoutes: this.layout.laneRoutes,
            spawnPoint: this.layout.primarySpawn,
            basePoint: this.layout.hub,
            spawnMultiplier: 1,
        });
    }
    joinPlayer(playerId) {
        const existingSlot = this.getPlayerSlot(playerId);
        if (existingSlot) {
            return existingSlot;
        }
        // 构筑在倒计时前已锁定；只允许旧玩家重连，不允许陌生玩家插入。
        if (!this.isAcceptingNewPlayers()) {
            return null;
        }
        const openSlot = exports.ROOM_SLOT_ORDER.find((slot) => !this.slotAssignments.has(slot));
        if (!openSlot) {
            return null;
        }
        this.slotAssignments.set(openSlot, playerId);
        // 第一个进入的玩家为房主
        if (!this.hostPlayerId) {
            this.hostPlayerId = playerId;
        }
        this.syncEngineRoomRules();
        return openSlot;
    }
    leavePlayer(playerId) {
        const slot = this.getPlayerSlot(playerId);
        if (!slot) {
            return false;
        }
        this.slotAssignments.delete(slot);
        // 房主离开时，将房主权移交给第一个剩余玩家
        if (this.hostPlayerId === playerId) {
            this.hostPlayerId = this.getFirstAssignedPlayerId();
        }
        this.syncEngineRoomRules();
        return true;
    }
    getPlayerCount() {
        return Math.max(1, this.slotAssignments.size);
    }
    getPlayerSlot(playerId) {
        for (const [slot, assignedPlayerId] of this.slotAssignments.entries()) {
            if (assignedPlayerId === playerId) {
                return slot;
            }
        }
        return null;
    }
    getActiveSlots() {
        const activeSlots = exports.ROOM_SLOT_ORDER.filter((slot) => this.slotAssignments.has(slot));
        return activeSlots.length > 0 ? activeSlots : ['P1'];
    }
    isEmpty() {
        return this.slotAssignments.size === 0;
    }
    getPhase() {
        if (this.phase === 'playing' && this.engine.isMatchFinished()) {
            return 'lobby';
        }
        return this.phase;
    }
    isAcceptingNewPlayers() {
        return this.getPhase() === 'lobby' && !this.countdownPreparing;
    }
    getHostPlayerId() {
        return this.hostPlayerId;
    }
    /** 返回当前房间内全部玩家 ID 列表 */
    getConnectedPlayerIds() {
        const connected = new Set(this.engine.getStateSnapshot().players
            .filter(player => player.connectionStatus === 'connected')
            .map(player => player.id));
        return [...this.slotAssignments.values()].filter(playerId => connected.has(playerId));
    }
    getSummary() {
        const players = this.engine.getStateSnapshot().players;
        return {
            id: this.id,
            name: this.displayName,
            hasPassword: this.hasPassword,
            players: this.slotAssignments.size,
            maxPlayers: exports.ROOM_SLOT_ORDER.length,
            phase: this.getPhase(),
            slots: exports.ROOM_SLOT_ORDER.map((slotId) => {
                const playerId = this.slotAssignments.get(slotId) ?? null;
                const player = playerId
                    ? players.find((candidate) => candidate.id === playerId) ?? null
                    : null;
                return {
                    slotId,
                    playerId,
                    playerName: player?.name ?? null,
                    connected: player?.connectionStatus === 'connected',
                    isHost: playerId !== null && playerId === this.hostPlayerId,
                };
            }),
        };
    }
    // ───────────────────────────────────────────────────────────────────────────
    // 生命周期状态机
    // ───────────────────────────────────────────────────────────────────────────
    /**
     * 房主按下开始，进入倒计时阶段。
     * - 合法前置：phase === 'lobby'  且 requestorPlayerId === hostPlayerId
     * - `onComplete` 在 3 秒后自动触发，应由 SocketGateway 向全房广播状态变化
     * @returns 'ok' | 'wrong_phase' | 'forbidden'
     */
    async beginCountdown(requestorPlayerId, onComplete) {
        if (this.getPhase() !== 'lobby') {
            return 'wrong_phase';
        }
        if (this.countdownPreparing)
            return 'wrong_phase';
        if (requestorPlayerId !== this.hostPlayerId) {
            return 'forbidden';
        }
        if (this.phase === 'playing' && !this.engine.resetForRematch()) {
            return 'wrong_phase';
        }
        this.countdownPreparing = true;
        try {
            await this.lockMatchBuildSnapshots();
        }
        catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            console.error(`Room ${this.id} failed to lock match build snapshots: ${details}`);
            return 'snapshot_failed';
        }
        finally {
            this.countdownPreparing = false;
        }
        this.phase = 'countdown';
        this.countdownTimer = setTimeout(() => {
            this.countdownTimer = null;
            this.phase = 'waiting_for_level';
            onComplete();
        }, 3000);
        return 'ok';
    }
    /**
     * 校验通过后点火引擎：加载关卡波次配置并启动刷怪。
     * 应由 SocketGateway 在所有校验通过后调用。
     */
    igniteWithLevel(waves, selection, startingGold) {
        this.pendingStageSelection = null;
        this.activeStageSelection = structuredClone(selection);
        this.phase = 'playing';
        this.engine.ignite(waves, startingGold, selection.levelId, selection.difficulty);
        this.stageSelectionsByMatchId.set(this.engine.getStateSnapshot().matchId, structuredClone(selection));
    }
    getMatchBuildSnapshot(playerId) {
        const snapshot = this.matchBuildSnapshots.get(playerId);
        return snapshot ? structuredClone(snapshot) : null;
    }
    /**
     * 权威结算钩子。调用方必须传入已由战斗服务确认的碎片，
     * Room 不会从 UI 或不完整快照猜测掉落。
     */
    async commitPlayerSettlement(input) {
        if (!this.accountRuntime)
            throw new Error('PLAYER_ACCOUNT_SERVICE_NOT_CONFIGURED');
        return this.accountRuntime.accountService.settleMatch({
            ...input,
        });
    }
    setPendingStageSelection(selection) {
        this.pendingStageSelection = structuredClone(selection);
    }
    consumePendingStageSelection() {
        const selection = this.pendingStageSelection;
        this.pendingStageSelection = null;
        return selection ? structuredClone(selection) : null;
    }
    getActiveStageSelection() {
        return this.activeStageSelection ? structuredClone(this.activeStageSelection) : null;
    }
    getStageSelectionForMatch(matchId) {
        const selection = this.stageSelectionsByMatchId.get(matchId);
        return selection ? structuredClone(selection) : null;
    }
    destroy() {
        this.pendingStageSelection = null;
        this.activeStageSelection = null;
        this.stageSelectionsByMatchId.clear();
        this.countdownPreparing = false;
        if (this.countdownTimer) {
            clearTimeout(this.countdownTimer);
            this.countdownTimer = null;
        }
    }
    async lockMatchBuildSnapshots() {
        if (!this.accountRuntime) {
            this.matchBuildSnapshots.clear();
            this.engine.setMatchBuildSnapshots({});
            return;
        }
        const matchId = this.engine.getStateSnapshot().matchId;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const playerIds = this.getConnectedPlayerIds().sort();
            const snapshots = await Promise.all(playerIds.map(async (playerId) => {
                const account = await this.accountRuntime.accountService.getOrCreate(playerId);
                return this.accountRuntime.accountService.createBuildSnapshot({
                    requestId: `lock-build:${matchId}:${playerId}`,
                    matchId,
                    playerId,
                    expectedAccountVersion: account.version,
                }, this.accountRuntime.buildResolver);
            }));
            const connectedAfterRead = this.getConnectedPlayerIds().sort();
            if (playerIds.length !== connectedAfterRead.length
                || playerIds.some((playerId, index) => playerId !== connectedAfterRead[index]))
                continue;
            this.matchBuildSnapshots.clear();
            for (const snapshot of snapshots)
                this.matchBuildSnapshots.set(snapshot.playerId, snapshot);
            this.engine.setMatchBuildSnapshots(Object.fromEntries(snapshots.map(snapshot => [snapshot.playerId, snapshot])));
            return;
        }
        throw new Error('CONNECTED_PLAYERS_CHANGED_DURING_BUILD_LOCK');
    }
    syncEngineRoomRules() {
        const activeSlots = this.getActiveSlots();
        const playerSlotAssignments = exports.ROOM_SLOT_ORDER.flatMap((slotId) => {
            const playerId = this.slotAssignments.get(slotId);
            return playerId ? [{ playerId, slotId }] : [];
        });
        this.engine.syncPlayerSlots(playerSlotAssignments);
        this.engine.setActiveSlots(activeSlots);
        this.engine.setPlayerCount(this.getPlayerCount());
    }
    getFirstAssignedPlayerId() {
        for (const slot of exports.ROOM_SLOT_ORDER) {
            const playerId = this.slotAssignments.get(slot);
            if (playerId) {
                return playerId;
            }
        }
        return null;
    }
}
exports.Room = Room;
class RoomManager {
    config;
    accountRuntime;
    rooms = new Map();
    constructor(config, accountRuntime) {
        this.config = config;
        this.accountRuntime = accountRuntime;
    }
    createRoom(roomId, options) {
        if (this.rooms.has(roomId)) {
            throw new Error(`Room ${roomId} already exists`);
        }
        const room = new Room(roomId, this.config, options, this.accountRuntime);
        this.rooms.set(roomId, room);
        return room;
    }
    getRoom(roomId) {
        return this.rooms.get(roomId) ?? null;
    }
    getOrCreateRoom(roomId, options) {
        return this.getRoom(roomId) ?? this.createRoom(roomId, options);
    }
    listRooms(options) {
        const includeEmpty = options?.includeEmpty ?? true;
        const rooms = [...this.rooms.values()];
        return includeEmpty ? rooms : rooms.filter((room) => !room.isEmpty());
    }
    removeRoom(roomId) {
        const room = this.rooms.get(roomId);
        room?.destroy();
        return this.rooms.delete(roomId);
    }
    removeEmptyRooms() {
        for (const [roomId, room] of this.rooms.entries()) {
            if (room.isEmpty()) {
                this.rooms.delete(roomId);
            }
        }
    }
}
exports.RoomManager = RoomManager;
