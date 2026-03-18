"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GridMap = void 0;
const WALKABLE_CELL_KINDS = new Set(['gate', 'core', 'path']);
function toKey(x, y) {
    return `${x},${y}`;
}
function clonePosition(position) {
    return { x: position.x, y: position.y };
}
function cloneTerrainCell(cell) {
    return {
        kind: cell.kind,
        label: cell.label,
    };
}
class GridMap {
    width;
    height;
    SPAWN_POINT;
    BASE_POINT;
    spawn;
    base;
    terrain;
    occupiedKeys = new Set();
    constructor(cellsOrGrid, spawn, base) {
        if (cellsOrGrid.length === 0 || cellsOrGrid[0]?.length === 0) {
            throw new Error('GridMap requires a non-empty 2D grid matrix');
        }
        this.height = cellsOrGrid.length;
        this.width = cellsOrGrid[0].length;
        this.SPAWN_POINT = clonePosition(spawn);
        this.BASE_POINT = clonePosition(base);
        this.spawn = this.SPAWN_POINT;
        this.base = this.BASE_POINT;
        if (!this.isInside(this.SPAWN_POINT.x, this.SPAWN_POINT.y) || !this.isInside(this.BASE_POINT.x, this.BASE_POINT.y)) {
            throw new Error('Spawn point and base point must be inside the grid');
        }
        this.terrain = this.normalizeTerrain(cellsOrGrid);
        this.terrain[this.SPAWN_POINT.y][this.SPAWN_POINT.x] = { kind: 'gate', label: '入口' };
        this.terrain[this.BASE_POINT.y][this.BASE_POINT.x] = { kind: 'core', label: '环形核心' };
    }
    static create(width, height, spawn, base, blocked = []) {
        const blockedKeys = new Set(blocked.map((position) => toKey(position.x, position.y)));
        const cells = [];
        for (let y = 0; y < height; y += 1) {
            const row = [];
            for (let x = 0; x < width; x += 1) {
                const key = toKey(x, y);
                const isSpawn = x === spawn.x && y === spawn.y;
                const isBase = x === base.x && y === base.y;
                const isPath = GridMap.isStraightLinePath(spawn, base, x, y);
                let kind = 'build';
                if (blockedKeys.has(key)) {
                    kind = 'blocked';
                }
                else if (isSpawn) {
                    kind = 'gate';
                }
                else if (isBase) {
                    kind = 'core';
                }
                else if (isPath) {
                    kind = 'path';
                }
                row.push({
                    x,
                    y,
                    kind,
                    walkable: WALKABLE_CELL_KINDS.has(kind),
                    buildable: kind === 'build',
                });
            }
            cells.push(row);
        }
        return new GridMap(cells, spawn, base);
    }
    setValidationOrigins(_origins) {
        // 固定轨道下，建塔合法性不再依赖动态连通性校验。
    }
    isInside(x, y) {
        return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
    }
    getCell(x, y) {
        if (!this.isInside(x, y)) {
            return null;
        }
        return this.createCellView(x, y);
    }
    isWalkable(x, y, blockedKeys) {
        if (!this.isInside(x, y)) {
            return false;
        }
        if (blockedKeys?.has(toKey(x, y))) {
            return false;
        }
        return WALKABLE_CELL_KINDS.has(this.terrain[y][x].kind);
    }
    occupy(x, y, width = 1, height = 1) {
        for (const position of this.getFootprintPositions(x, y, width, height)) {
            if (!this.isInside(position.x, position.y)) {
                continue;
            }
            if (this.terrain[position.y][position.x].kind !== 'build') {
                continue;
            }
            this.occupiedKeys.add(toKey(position.x, position.y));
        }
    }
    release(x, y, width = 1, height = 1) {
        for (const position of this.getFootprintPositions(x, y, width, height)) {
            this.occupiedKeys.delete(toKey(position.x, position.y));
        }
    }
    toCells() {
        const cells = [];
        for (let y = 0; y < this.height; y += 1) {
            for (let x = 0; x < this.width; x += 1) {
                cells.push(this.createCellView(x, y));
            }
        }
        return cells;
    }
    canBuildTower(x, y, width = 1, height = 1) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
            return false;
        }
        for (const position of this.getFootprintPositions(x, y, width, height)) {
            const cell = this.getCell(position.x, position.y);
            if (!cell || !cell.buildable) {
                return false;
            }
        }
        return true;
    }
    findPath(startOrX, startYOrGoal, endX, endY) {
        if (typeof startOrX === 'number' && typeof startYOrGoal === 'number' && typeof endX === 'number' && typeof endY === 'number') {
            return this.findPathInternal(startOrX, startYOrGoal, endX, endY);
        }
        if (typeof startOrX === 'object' && typeof startYOrGoal === 'object') {
            return this.findPathInternal(startOrX.x, startOrX.y, startYOrGoal.x, startYOrGoal.y);
        }
        throw new Error('findPath expects either coordinates or start/goal positions');
    }
    findPathInternal(startX, startY, endX, endY, blockedKeys) {
        if (!this.isInside(startX, startY) || !this.isInside(endX, endY)) {
            return null;
        }
        if (!this.isWalkable(startX, startY, blockedKeys) || !this.isWalkable(endX, endY, blockedKeys)) {
            return null;
        }
        const startKey = toKey(startX, startY);
        const goalKey = toKey(endX, endY);
        const queue = [{ x: startX, y: startY }];
        const visited = new Set([startKey]);
        const cameFrom = new Map();
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const currentKey = toKey(current.x, current.y);
            if (currentKey === goalKey) {
                return this.reconstructPath(cameFrom, currentKey);
            }
            for (const neighbor of this.getNeighbors(current.x, current.y)) {
                const neighborKey = toKey(neighbor.x, neighbor.y);
                if (visited.has(neighborKey) || !this.isWalkable(neighbor.x, neighbor.y, blockedKeys)) {
                    continue;
                }
                visited.add(neighborKey);
                cameFrom.set(neighborKey, currentKey);
                queue.push(neighbor);
            }
        }
        return null;
    }
    getNeighbors(x, y) {
        const neighbors = [];
        const directions = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
        ];
        for (const direction of directions) {
            const nextX = x + direction.x;
            const nextY = y + direction.y;
            if (this.isInside(nextX, nextY)) {
                neighbors.push({ x: nextX, y: nextY });
            }
        }
        return neighbors;
    }
    reconstructPath(cameFrom, currentKey) {
        const path = [];
        let cursor = currentKey;
        while (cursor) {
            const [x, y] = cursor.split(',').map(Number);
            path.push({ x, y });
            cursor = cameFrom.get(cursor);
        }
        path.reverse();
        return path;
    }
    normalizeTerrain(cellsOrGrid) {
        return cellsOrGrid.map((row) => row.map((cellOrValue) => {
            if (typeof cellOrValue === 'number') {
                return {
                    kind: cellOrValue === 0 ? 'path' : 'build',
                };
            }
            return cloneTerrainCell({
                kind: cellOrValue.kind,
                label: cellOrValue.label,
            });
        }));
    }
    createCellView(x, y) {
        const terrainCell = this.terrain[y][x];
        const occupied = this.occupiedKeys.has(toKey(x, y));
        const walkable = WALKABLE_CELL_KINDS.has(terrainCell.kind);
        const buildable = terrainCell.kind === 'build' && !occupied;
        return {
            x,
            y,
            kind: terrainCell.kind,
            walkable,
            buildable,
            label: terrainCell.label,
        };
    }
    getFootprintPositions(x, y, width, height) {
        const positions = [];
        for (let offsetY = 0; offsetY < height; offsetY += 1) {
            for (let offsetX = 0; offsetX < width; offsetX += 1) {
                positions.push({
                    x: x + offsetX,
                    y: y + offsetY,
                });
            }
        }
        return positions;
    }
    static isStraightLinePath(spawn, base, x, y) {
        if (spawn.x === base.x && x === spawn.x) {
            return y >= Math.min(spawn.y, base.y) && y <= Math.max(spawn.y, base.y);
        }
        if (spawn.y === base.y && y === spawn.y) {
            return x >= Math.min(spawn.x, base.x) && x <= Math.max(spawn.x, base.x);
        }
        return false;
    }
}
exports.GridMap = GridMap;
