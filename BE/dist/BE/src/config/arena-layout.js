"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAYPOINTS_MAP = exports.LOOP_REENTRY_OFFSET = exports.ARENA_GRID_SIZE = void 0;
exports.getArenaLoopStartIndex = getArenaLoopStartIndex;
exports.getArenaPrimarySpawnPoint = getArenaPrimarySpawnPoint;
exports.getArenaPrimaryBasePoint = getArenaPrimaryBasePoint;
exports.createArenaGridMatrix = createArenaGridMatrix;
exports.createArenaMapCells = createArenaMapCells;
exports.ARENA_GRID_SIZE = 30;
exports.LOOP_REENTRY_OFFSET = 5;
exports.WAYPOINTS_MAP = {
    P1: [
        { x: 14, y: 16 },
        { x: 14, y: 19 },
        { x: 8, y: 19 },
        { x: 8, y: 22 },
        { x: 22, y: 22 },
        { x: 22, y: 8 },
        { x: 8, y: 8 },
        { x: 8, y: 15 },
        { x: 4, y: 15 },
        { x: 4, y: 4 },
        { x: 26, y: 4 },
        { x: 26, y: 26 },
        { x: 4, y: 26 },
        { x: 4, y: 15 },
    ],
    P2: [
        { x: 16, y: 16 },
        { x: 19, y: 16 },
        { x: 19, y: 22 },
        { x: 22, y: 22 },
        { x: 22, y: 8 },
        { x: 8, y: 8 },
        { x: 8, y: 22 },
        { x: 15, y: 22 },
        { x: 15, y: 26 },
        { x: 4, y: 26 },
        { x: 4, y: 4 },
        { x: 26, y: 4 },
        { x: 26, y: 26 },
        { x: 15, y: 26 },
    ],
    P3: [
        { x: 16, y: 14 },
        { x: 16, y: 11 },
        { x: 22, y: 11 },
        { x: 22, y: 8 },
        { x: 8, y: 8 },
        { x: 8, y: 22 },
        { x: 22, y: 22 },
        { x: 22, y: 15 },
        { x: 26, y: 15 },
        { x: 26, y: 26 },
        { x: 4, y: 26 },
        { x: 4, y: 4 },
        { x: 26, y: 4 },
        { x: 26, y: 15 },
    ],
    P4: [
        { x: 14, y: 14 },
        { x: 11, y: 14 },
        { x: 11, y: 8 },
        { x: 8, y: 8 },
        { x: 8, y: 22 },
        { x: 22, y: 22 },
        { x: 22, y: 8 },
        { x: 15, y: 8 },
        { x: 15, y: 4 },
        { x: 26, y: 4 },
        { x: 26, y: 26 },
        { x: 4, y: 26 },
        { x: 4, y: 4 },
        { x: 15, y: 4 },
    ],
};
const ARENA_SLOT_ORDER = ['P1', 'P2', 'P3', 'P4'];
function clonePosition(position) {
    return { x: position.x, y: position.y };
}
function positionKey(x, y) {
    return `${x},${y}`;
}
function getLinePositions(start, end) {
    const positions = [];
    if (start.x !== end.x && start.y !== end.y) {
        throw new Error(`Arena waypoint segments must be axis-aligned: (${start.x}, ${start.y}) -> (${end.x}, ${end.y})`);
    }
    if (start.x === end.x) {
        const step = start.y <= end.y ? 1 : -1;
        for (let y = start.y; y !== end.y + step; y += step) {
            positions.push({ x: start.x, y });
        }
        return positions;
    }
    const step = start.x <= end.x ? 1 : -1;
    for (let x = start.x; x !== end.x + step; x += step) {
        positions.push({ x, y: start.y });
    }
    return positions;
}
function getArenaLoopStartIndex(path) {
    if (path.length === 0) {
        return 0;
    }
    return Math.max(0, path.length - exports.LOOP_REENTRY_OFFSET);
}
function getArenaPrimarySpawnPoint() {
    return clonePosition(exports.WAYPOINTS_MAP.P1[0]);
}
function getArenaPrimaryBasePoint() {
    return clonePosition(exports.WAYPOINTS_MAP.P1[exports.WAYPOINTS_MAP.P1.length - 1]);
}
function createArenaGridMatrix(width, height) {
    if (width < exports.ARENA_GRID_SIZE || height < exports.ARENA_GRID_SIZE) {
        throw new Error(`Arena grid requires at least ${exports.ARENA_GRID_SIZE}x${exports.ARENA_GRID_SIZE} cells`);
    }
    const grid = Array.from({ length: height }, () => Array(width).fill(1));
    for (const slot of ARENA_SLOT_ORDER) {
        const path = exports.WAYPOINTS_MAP[slot];
        for (let index = 0; index < path.length - 1; index += 1) {
            const start = path[index];
            const end = path[index + 1];
            for (const position of getLinePositions(start, end)) {
                if (position.x < 0 || position.y < 0 || position.x >= width || position.y >= height) {
                    throw new Error(`Arena waypoint is outside of the grid: (${position.x}, ${position.y})`);
                }
                grid[position.y][position.x] = 0;
            }
        }
    }
    return grid;
}
function createArenaMapCells(width, height) {
    const grid = createArenaGridMatrix(width, height);
    const primaryBasePoint = getArenaPrimaryBasePoint();
    const gateByKey = new Map();
    for (const slot of ARENA_SLOT_ORDER) {
        const spawn = exports.WAYPOINTS_MAP[slot][0];
        gateByKey.set(positionKey(spawn.x, spawn.y), `${slot} 入口`);
    }
    return grid.map((row, y) => row.map((value, x) => {
        const gateLabel = gateByKey.get(positionKey(x, y));
        let kind = 'build';
        let label;
        if (gateLabel) {
            kind = 'gate';
            label = gateLabel;
        }
        else if (x === primaryBasePoint.x && y === primaryBasePoint.y) {
            kind = 'core';
            label = '循环锚点';
        }
        else if (value === 0) {
            kind = 'path';
        }
        return {
            x,
            y,
            kind,
            walkable: kind === 'gate' || kind === 'core' || kind === 'path',
            buildable: kind === 'build',
            label,
        };
    }));
}
