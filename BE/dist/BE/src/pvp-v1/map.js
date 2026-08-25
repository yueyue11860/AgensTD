"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUAL_REALM_MAP = exports.PVP_B_ROUTE_ANCHORS = exports.PVP_A_ROUTE_ANCHORS = exports.PVP_ENEMY_BODY_RADIUS_MILLI = exports.PVP_NEUTRAL_BOUNDARY_Y = exports.PVP_GRID_SIZE = exports.PVP_DUAL_REALM_MAP_VERSION = exports.PVP_DUAL_REALM_MAP_ID = void 0;
exports.mirrorPvpPosition = mirrorPvpPosition;
exports.expandAxisAlignedRoute = expandAxisAlignedRoute;
exports.compileDualRealmMap = compileDualRealmMap;
exports.isPvpDeployableCell = isPvpDeployableCell;
exports.hasEnemyBodyFullyExitedPvpSpawnGate = hasEnemyBodyFullyExitedPvpSpawnGate;
const node_crypto_1 = require("node:crypto");
exports.PVP_DUAL_REALM_MAP_ID = 'pvp_dual_realm_v1';
exports.PVP_DUAL_REALM_MAP_VERSION = 1;
exports.PVP_GRID_SIZE = 29;
exports.PVP_NEUTRAL_BOUNDARY_Y = 14;
exports.PVP_ENEMY_BODY_RADIUS_MILLI = 406;
exports.PVP_A_ROUTE_ANCHORS = [
    { x: 14, y: 1 },
    { x: 14, y: 3 },
    { x: 4, y: 3 },
    { x: 4, y: 11 },
    { x: 24, y: 11 },
    { x: 24, y: 5 },
    { x: 9, y: 5 },
    { x: 9, y: 9 },
    { x: 19, y: 9 },
    { x: 19, y: 7 },
    { x: 14, y: 7 },
    { x: 14, y: 12 },
];
function mirrorPvpPosition(position) {
    return { x: position.x, y: exports.PVP_GRID_SIZE - 1 - position.y };
}
exports.PVP_B_ROUTE_ANCHORS = exports.PVP_A_ROUTE_ANCHORS.map(mirrorPvpPosition);
function positionKey(position) {
    return `${position.x},${position.y}`;
}
function rangeInclusive(start, end) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
function rectangleCells(minX, maxX, minY, maxY) {
    return rangeInclusive(minY, maxY).flatMap((y) => rangeInclusive(minX, maxX).map((x) => ({ x, y })));
}
function expandAxisAlignedRoute(anchors) {
    if (anchors.length < 2)
        throw new Error('PVP_ROUTE_REQUIRES_AT_LEAST_TWO_ANCHORS');
    const result = [];
    for (let index = 0; index < anchors.length - 1; index += 1) {
        const start = anchors[index];
        const end = anchors[index + 1];
        if (start.x !== end.x && start.y !== end.y) {
            throw new Error(`PVP_ROUTE_SEGMENT_NOT_AXIS_ALIGNED:${index}`);
        }
        const dx = Math.sign(end.x - start.x);
        const dy = Math.sign(end.y - start.y);
        let x = start.x;
        let y = start.y;
        while (true) {
            if (result.length === 0 || result[result.length - 1].x !== x || result[result.length - 1].y !== y) {
                result.push({ x, y });
            }
            if (x === end.x && y === end.y)
                break;
            x += dx;
            y += dy;
        }
    }
    return result;
}
function compileSide(side, routeAnchors) {
    const ownMinY = side === 'A' ? 0 : 15;
    const ownMaxY = side === 'A' ? 13 : 28;
    const spawnGateCells = side === 'A'
        ? rectangleCells(13, 15, 0, 2)
        : rectangleCells(13, 15, 26, 28);
    const coreCells = side === 'A'
        ? rectangleCells(13, 15, 11, 13)
        : rectangleCells(13, 15, 15, 17);
    const routeCells = expandAxisAlignedRoute(routeAnchors);
    const excluded = new Set([
        ...spawnGateCells.map(positionKey),
        ...coreCells.map(positionKey),
        ...routeCells.map(positionKey),
    ]);
    const deployableCells = rectangleCells(0, 28, ownMinY, ownMaxY)
        .filter((position) => !excluded.has(positionKey(position)));
    return {
        side,
        spawnGateCells,
        coreCells,
        routeAnchors: routeAnchors.map(({ x, y }) => ({ x, y })),
        routeCells,
        deployableCells,
    };
}
function createRouteHash(sides) {
    const payload = ['A', 'B'].map((side) => ({
        side,
        route: sides[side].routeCells.map(({ x, y }) => [x, y]),
        deployable: sides[side].deployableCells.map(({ x, y }) => [x, y]),
    }));
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(payload)).digest('hex');
}
function compileDualRealmMap() {
    const sides = {
        A: compileSide('A', exports.PVP_A_ROUTE_ANCHORS),
        B: compileSide('B', exports.PVP_B_ROUTE_ANCHORS),
    };
    const pathByKey = new Map();
    const spawnByKey = new Map();
    const coreByKey = new Map();
    const deployableByKey = new Map();
    for (const side of ['A', 'B']) {
        for (const position of sides[side].routeCells)
            pathByKey.set(positionKey(position), side);
        for (const position of sides[side].spawnGateCells)
            spawnByKey.set(positionKey(position), side);
        for (const position of sides[side].coreCells)
            coreByKey.set(positionKey(position), side);
        for (const position of sides[side].deployableCells)
            deployableByKey.set(positionKey(position), side);
    }
    const cells = rectangleCells(0, 28, 0, 28).map((position) => {
        const key = positionKey(position);
        const spawnSide = spawnByKey.get(key);
        const coreSide = coreByKey.get(key);
        const pathSide = pathByKey.get(key);
        const deployableSide = deployableByKey.get(key);
        if (position.y === exports.PVP_NEUTRAL_BOUNDARY_Y) {
            return { ...position, kind: 'neutral_boundary', ownerSide: null, deployable: false, walkable: false };
        }
        if (spawnSide) {
            return { ...position, kind: 'spawn_gate', ownerSide: spawnSide, deployable: false, walkable: true };
        }
        if (coreSide) {
            return { ...position, kind: 'core', ownerSide: coreSide, deployable: false, walkable: true };
        }
        if (pathSide) {
            return { ...position, kind: 'path', ownerSide: pathSide, deployable: false, walkable: true };
        }
        if (!deployableSide)
            throw new Error(`PVP_MAP_CELL_UNCLASSIFIED:${key}`);
        return { ...position, kind: 'deployable', ownerSide: deployableSide, deployable: true, walkable: false };
    });
    return {
        mapId: exports.PVP_DUAL_REALM_MAP_ID,
        mapVersion: exports.PVP_DUAL_REALM_MAP_VERSION,
        width: exports.PVP_GRID_SIZE,
        height: exports.PVP_GRID_SIZE,
        neutralBoundaryY: exports.PVP_NEUTRAL_BOUNDARY_Y,
        routeHash: createRouteHash(sides),
        cells,
        sides,
    };
}
exports.DUAL_REALM_MAP = compileDualRealmMap();
function isPvpDeployableCell(side, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y))
        return false;
    return exports.DUAL_REALM_MAP.sides[side].deployableCells.some((cell) => cell.x === x && cell.y === y);
}
function hasEnemyBodyFullyExitedPvpSpawnGate(side, xMilli, yMilli, radiusMilli = exports.PVP_ENEMY_BODY_RADIUS_MILLI) {
    const minXMilli = 12_500;
    const maxXMilli = 15_500;
    const minYMilli = side === 'A' ? -500 : 25_500;
    const maxYMilli = side === 'A' ? 2_500 : 28_500;
    return xMilli + radiusMilli < minXMilli
        || xMilli - radiusMilli > maxXMilli
        || yMilli + radiusMilli < minYMilli
        || yMilli - radiusMilli > maxYMilli;
}
