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
        this.syncEngineRoomRules();
        return openSlot;
    }
    leavePlayer(playerId) {
        const slot = this.getPlayerSlot(playerId);
        if (!slot) {
            return false;
        }
        this.slotAssignments.delete(slot);
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
    syncEngineRoomRules() {
        const activeSlots = this.getActiveSlots();
        this.engine.setActiveSlots(activeSlots);
        this.engine.setPlayerCount(this.getPlayerCount());
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
