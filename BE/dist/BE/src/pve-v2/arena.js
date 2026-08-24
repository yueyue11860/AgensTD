"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PVE_LANE_ROUTES = exports.PVE_ENEMY_BODY_RADIUS_MILLI = exports.PVE_SPAWN_SQUARE_MAX = exports.PVE_SPAWN_SQUARE_MIN = exports.PVE_LANE_SLOTS = exports.PVE_ARENA_GRID_SIZE = void 0;
exports.belongsToSlotQuadrant = belongsToSlotQuadrant;
exports.isPveBoardDeployableCell = isPveBoardDeployableCell;
exports.isDefaultDeployableCell = isDefaultDeployableCell;
exports.hasEnemyBodyFullyExitedPveSpawnSquareMilli = hasEnemyBodyFullyExitedPveSpawnSquareMilli;
exports.createPveLaneRoutes = createPveLaneRoutes;
exports.getDefaultSoldierPlacement = getDefaultSoldierPlacement;
exports.PVE_ARENA_GRID_SIZE = 29;
exports.PVE_LANE_SLOTS = ['P1', 'P2', 'P3', 'P4'];
/** 中央标有 P1/P2/P3/P4 的 3×3（共 9 格）小怪出生方格。 */
exports.PVE_SPAWN_SQUARE_MIN = 13;
exports.PVE_SPAWN_SQUARE_MAX = 15;
/** 与前端 13px / 32px 的小怪圆形体积对应。 */
exports.PVE_ENEMY_BODY_RADIUS_MILLI = 406;
const PVE_SPAWN_SQUARE_MIN_BOUNDARY_MILLI = exports.PVE_SPAWN_SQUARE_MIN * 1000 - 500;
const PVE_SPAWN_SQUARE_MAX_BOUNDARY_MILLI = exports.PVE_SPAWN_SQUARE_MAX * 1000 + 500;
const DEFAULT_WAYPOINTS = {
    P1: [
        { x: 13, y: 15 }, { x: 13, y: 18 }, { x: 7, y: 18 }, { x: 7, y: 21 },
        { x: 21, y: 21 }, { x: 21, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 14 },
        { x: 3, y: 14 }, { x: 3, y: 3 }, { x: 25, y: 3 }, { x: 25, y: 25 },
        { x: 3, y: 25 }, { x: 3, y: 14 },
    ],
    P2: [
        { x: 15, y: 15 }, { x: 18, y: 15 }, { x: 18, y: 21 }, { x: 21, y: 21 },
        { x: 21, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 21 }, { x: 14, y: 21 },
        { x: 14, y: 25 }, { x: 3, y: 25 }, { x: 3, y: 3 }, { x: 25, y: 3 },
        { x: 25, y: 25 }, { x: 14, y: 25 },
    ],
    P3: [
        { x: 15, y: 13 }, { x: 15, y: 10 }, { x: 21, y: 10 }, { x: 21, y: 7 },
        { x: 7, y: 7 }, { x: 7, y: 21 }, { x: 21, y: 21 }, { x: 21, y: 14 },
        { x: 25, y: 14 }, { x: 25, y: 25 }, { x: 3, y: 25 }, { x: 3, y: 3 },
        { x: 25, y: 3 }, { x: 25, y: 14 },
    ],
    P4: [
        { x: 13, y: 13 }, { x: 10, y: 13 }, { x: 10, y: 7 }, { x: 7, y: 7 },
        { x: 7, y: 21 }, { x: 21, y: 21 }, { x: 21, y: 7 }, { x: 14, y: 7 },
        { x: 14, y: 3 }, { x: 25, y: 3 }, { x: 25, y: 25 }, { x: 3, y: 25 },
        { x: 3, y: 3 }, { x: 14, y: 3 },
    ],
};
function cloneWaypoints(waypoints) {
    return waypoints.map(({ x, y }) => ({ x, y }));
}
exports.DEFAULT_PVE_LANE_ROUTES = {
    P1: { waypoints: cloneWaypoints(DEFAULT_WAYPOINTS.P1), loopStartIndex: 8 },
    P2: { waypoints: cloneWaypoints(DEFAULT_WAYPOINTS.P2), loopStartIndex: 8 },
    P3: { waypoints: cloneWaypoints(DEFAULT_WAYPOINTS.P3), loopStartIndex: 8 },
    P4: { waypoints: cloneWaypoints(DEFAULT_WAYPOINTS.P4), loopStartIndex: 8 },
};
function positionKey(x, y) {
    return `${x},${y}`;
}
function segmentCells(start, end) {
    if (start.x !== end.x && start.y !== end.y) {
        throw new Error(`PVE V2 route segment must be axis aligned: ${positionKey(start.x, start.y)}`);
    }
    const cells = [];
    const dx = Math.sign(end.x - start.x);
    const dy = Math.sign(end.y - start.y);
    let x = start.x;
    let y = start.y;
    while (true) {
        cells.push({ x, y });
        if (x === end.x && y === end.y) {
            return cells;
        }
        x += dx;
        y += dy;
    }
}
function buildPathCellKeys(routes) {
    const keys = new Set();
    for (const slot of exports.PVE_LANE_SLOTS) {
        const route = routes[slot];
        for (let index = 0; index < route.waypoints.length - 1; index += 1) {
            for (const position of segmentCells(route.waypoints[index], route.waypoints[index + 1])) {
                keys.add(positionKey(position.x, position.y));
            }
        }
    }
    return keys;
}
const DEFAULT_PATH_CELL_KEYS = buildPathCellKeys(exports.DEFAULT_PVE_LANE_ROUTES);
/** 保留给未来需要领地规则的模式（例如 PVP）；当前 PVE 不使用该限制。 */
function belongsToSlotQuadrant(slot, x, y) {
    switch (slot) {
        case 'P1': return x <= 13 && y >= 15;
        case 'P2': return x >= 15 && y >= 15;
        case 'P3': return x >= 15 && y <= 13;
        case 'P4': return x <= 13 && y <= 13;
    }
}
function isPveBoardDeployableCell(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= exports.PVE_ARENA_GRID_SIZE || y >= exports.PVE_ARENA_GRID_SIZE) {
        return false;
    }
    if (x >= 13 && x <= 15 && y >= 13 && y <= 15) {
        return false;
    }
    return !DEFAULT_PATH_CELL_KEYS.has(positionKey(x, y));
}
function isDefaultDeployableCell(_slot, x, y) {
    return isPveBoardDeployableCell(x, y);
}
/**
 * 小怪的整个圆形身体是否已完全离开中央 3×3 出生方格。
 * 不能只用中心点或身体前缘判断；必须让身体后缘也越过方格外沿。
 */
function hasEnemyBodyFullyExitedPveSpawnSquareMilli(xMilli, yMilli, radiusMilli = exports.PVE_ENEMY_BODY_RADIUS_MILLI) {
    return xMilli + radiusMilli < PVE_SPAWN_SQUARE_MIN_BOUNDARY_MILLI
        || xMilli - radiusMilli > PVE_SPAWN_SQUARE_MAX_BOUNDARY_MILLI
        || yMilli + radiusMilli < PVE_SPAWN_SQUARE_MIN_BOUNDARY_MILLI
        || yMilli - radiusMilli > PVE_SPAWN_SQUARE_MAX_BOUNDARY_MILLI;
}
function createPveLaneRoutes(overrides) {
    const routes = {};
    for (const slot of exports.PVE_LANE_SLOTS) {
        const route = overrides?.[slot] ?? exports.DEFAULT_PVE_LANE_ROUTES[slot];
        if (route.waypoints.length < 2
            || !Number.isInteger(route.loopStartIndex)
            || route.loopStartIndex < 0
            || route.loopStartIndex >= route.waypoints.length) {
            throw new Error(`Invalid PVE V2 lane route for ${slot}`);
        }
        for (let index = 0; index < route.waypoints.length; index += 1) {
            const waypoint = route.waypoints[index];
            if (!Number.isInteger(waypoint.x)
                || !Number.isInteger(waypoint.y)
                || waypoint.x < 0
                || waypoint.y < 0
                || waypoint.x >= exports.PVE_ARENA_GRID_SIZE
                || waypoint.y >= exports.PVE_ARENA_GRID_SIZE) {
                throw new Error(`Invalid PVE V2 waypoint for ${slot} at ${index}`);
            }
            const next = route.waypoints[index + 1];
            if (next && waypoint.x !== next.x && waypoint.y !== next.y) {
                throw new Error(`PVE V2 route for ${slot} contains a diagonal segment at ${index}`);
            }
        }
        routes[slot] = {
            waypoints: cloneWaypoints(route.waypoints),
            loopStartIndex: route.loopStartIndex,
        };
    }
    return routes;
}
function getDefaultSoldierPlacement(slot) {
    switch (slot) {
        case 'P1': return { x: 9, y: 17 };
        case 'P2': return { x: 17, y: 19 };
        case 'P3': return { x: 19, y: 11 };
        case 'P4': return { x: 9, y: 9 };
    }
}
