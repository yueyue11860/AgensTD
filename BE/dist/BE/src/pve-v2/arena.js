"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PVE_LANE_ROUTES = exports.PVE_LANE_SLOTS = exports.PVE_ARENA_GRID_SIZE = void 0;
exports.isDefaultDeployableCell = isDefaultDeployableCell;
exports.createPveLaneRoutes = createPveLaneRoutes;
exports.getDefaultSoldierPlacement = getDefaultSoldierPlacement;
exports.PVE_ARENA_GRID_SIZE = 29;
exports.PVE_LANE_SLOTS = ['P1', 'P2', 'P3', 'P4'];
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
function belongsToSlotQuadrant(slot, x, y) {
    switch (slot) {
        case 'P1': return x <= 13 && y >= 15;
        case 'P2': return x >= 15 && y >= 15;
        case 'P3': return x >= 15 && y <= 13;
        case 'P4': return x <= 13 && y <= 13;
    }
}
function isDefaultDeployableCell(slot, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= exports.PVE_ARENA_GRID_SIZE || y >= exports.PVE_ARENA_GRID_SIZE) {
        return false;
    }
    if (!belongsToSlotQuadrant(slot, x, y)) {
        return false;
    }
    if (x >= 13 && x <= 15 && y >= 13 && y <= 15) {
        return false;
    }
    return !DEFAULT_PATH_CELL_KEYS.has(positionKey(x, y));
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
        case 'P1': return { x: 12, y: 16 };
        case 'P2': return { x: 16, y: 16 };
        case 'P3': return { x: 16, y: 12 };
        case 'P4': return { x: 12, y: 12 };
    }
}
