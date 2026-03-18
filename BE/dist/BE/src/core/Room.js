"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomManager = exports.Room = exports.ROOM_SLOT_ORDER = void 0;
exports.createFixedRoomLayout = createFixedRoomLayout;
const arena_layout_1 = require("../config/arena-layout");
const game_engine_1 = require("./game-engine");
exports.ROOM_SLOT_ORDER = ['P1', 'P2', 'P3', 'P4'];
const MIN_ROOM_WIDTH = arena_layout_1.ARENA_GRID_SIZE;
const MIN_ROOM_HEIGHT = arena_layout_1.ARENA_GRID_SIZE;
const HUB = (0, arena_layout_1.getArenaPrimaryBasePoint)();
function clonePath(path) {
    return path.map((position) => ({ x: position.x, y: position.y }));
}
function createLaneRoutes() {
    return {
        P1: {
            slot: 'P1',
            spawn: { ...arena_layout_1.WAYPOINTS_MAP.P1[0] },
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P1),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P1),
        },
        P2: {
            slot: 'P2',
            spawn: { ...arena_layout_1.WAYPOINTS_MAP.P2[0] },
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P2),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P2),
        },
        P3: {
            slot: 'P3',
            spawn: { ...arena_layout_1.WAYPOINTS_MAP.P3[0] },
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P3),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P3),
        },
        P4: {
            slot: 'P4',
            spawn: { ...arena_layout_1.WAYPOINTS_MAP.P4[0] },
            path: clonePath(arena_layout_1.WAYPOINTS_MAP.P4),
            loopStartIndex: (0, arena_layout_1.getArenaLoopStartIndex)(arena_layout_1.WAYPOINTS_MAP.P4),
        },
    };
}
function createFixedRoomLayout(width, height) {
    if (width < MIN_ROOM_WIDTH || height < MIN_ROOM_HEIGHT) {
        throw new Error(`Arena room requires at least ${MIN_ROOM_WIDTH}x${MIN_ROOM_HEIGHT} cells`);
    }
    const laneRoutes = createLaneRoutes();
    const cells = (0, arena_layout_1.createArenaMapCells)(width, height);
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
    id;
    layout;
    engine;
    slotAssignments = new Map();
    // 房间生命周期状态机
    phase = 'lobby';
    // 第一个加入的玩家为房主
    hostPlayerId = null;
    // 倒计时定时器句柄（idle 时务必清除）
    countdownTimer = null;
    constructor(id, config) {
        this.id = id;
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
        return this.phase;
    }
    getHostPlayerId() {
        return this.hostPlayerId;
    }
    /** 返回当前房间内全部玩家 ID 列表 */
    getConnectedPlayerIds() {
        return [...this.slotAssignments.values()];
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
    beginCountdown(requestorPlayerId, onComplete) {
        if (this.phase !== 'lobby') {
            return 'wrong_phase';
        }
        if (requestorPlayerId !== this.hostPlayerId) {
            return 'forbidden';
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
    igniteWithLevel(waves, startingGold) {
        this.phase = 'playing';
        this.engine.ignite(waves, startingGold);
    }
    syncEngineRoomRules() {
        const activeSlots = this.getActiveSlots();
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
    rooms = new Map();
    constructor(config) {
        this.config = config;
    }
    createRoom(roomId) {
        if (this.rooms.has(roomId)) {
            throw new Error(`Room ${roomId} already exists`);
        }
        const room = new Room(roomId, this.config);
        this.rooms.set(roomId, room);
        return room;
    }
    getRoom(roomId) {
        return this.rooms.get(roomId) ?? null;
    }
    getOrCreateRoom(roomId) {
        return this.getRoom(roomId) ?? this.createRoom(roomId);
    }
    listRooms() {
        return [...this.rooms.values()];
    }
    removeRoom(roomId) {
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
