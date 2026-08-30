"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectFrontendUiState = projectFrontendUiState;
exports.projectFrontendGameState = projectFrontendGameState;
exports.projectFrontendGameStatePatch = projectFrontendGameStatePatch;
exports.projectFrontendNoticeUpdate = projectFrontendNoticeUpdate;
exports.projectFrontendUiStateUpdate = projectFrontendUiStateUpdate;
const pve_state_delta_1 = require("../../../shared/contracts/pve-state-delta");
let cachedMapCellsSource = null;
let cachedProjectedMapCells = null;
function areMapCellsEquivalent(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const leftCell = left[index];
        const rightCell = right[index];
        if (leftCell.x !== rightCell.x
            || leftCell.y !== rightCell.y
            || leftCell.kind !== rightCell.kind
            || leftCell.walkable !== rightCell.walkable
            || leftCell.buildable !== rightCell.buildable
            || leftCell.label !== rightCell.label) {
            return false;
        }
    }
    return true;
}
function areProjectedCellsEquivalent(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const leftCell = left[index];
        const rightCell = right[index];
        if (leftCell.x !== rightCell.x
            || leftCell.y !== rightCell.y
            || leftCell.kind !== rightCell.kind
            || leftCell.walkable !== rightCell.walkable
            || leftCell.buildable !== rightCell.buildable
            || leftCell.label !== rightCell.label) {
            return false;
        }
    }
    return true;
}
function areProjectedMapsEquivalent(left, right) {
    return left.width === right.width
        && left.height === right.height
        && areProjectedCellsEquivalent(left.cells, right.cells);
}
function areStringArraysEquivalent(left, right) {
    const normalizedLeft = left ?? [];
    const normalizedRight = right ?? [];
    if (normalizedLeft.length !== normalizedRight.length) {
        return false;
    }
    for (let index = 0; index < normalizedLeft.length; index += 1) {
        if (normalizedLeft[index] !== normalizedRight[index]) {
            return false;
        }
    }
    return true;
}
function areActionDescriptorsEquivalent(left, right) {
    return left.id === right.id
        && left.label === right.label
        && left.description === right.description
        && left.disabled === right.disabled
        && left.reason === right.reason
        && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}
function areActionBarsEquivalent(left, right) {
    if (!left && !right) {
        return true;
    }
    if (!left || !right) {
        return false;
    }
    if (left.title !== right.title || left.summary !== right.summary || left.actions.length !== right.actions.length) {
        return false;
    }
    for (let index = 0; index < left.actions.length; index += 1) {
        if (!areActionDescriptorsEquivalent(left.actions[index], right.actions[index])) {
            return false;
        }
    }
    return true;
}
function areBuildPalettesEquivalent(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const leftEntry = left[index];
        const rightEntry = right[index];
        if (leftEntry.type !== rightEntry.type
            || leftEntry.label !== rightEntry.label
            || leftEntry.description !== rightEntry.description
            || leftEntry.costLabel !== rightEntry.costLabel
            || leftEntry.hotkey !== rightEntry.hotkey
            || leftEntry.disabled !== rightEntry.disabled
            || leftEntry.reason !== rightEntry.reason) {
            return false;
        }
    }
    return true;
}
function areTowerCommandsEquivalent(left, right) {
    const normalizedLeft = left ?? [];
    const normalizedRight = right ?? [];
    if (normalizedLeft.length !== normalizedRight.length) {
        return false;
    }
    for (let index = 0; index < normalizedLeft.length; index += 1) {
        const leftCommand = normalizedLeft[index];
        const rightCommand = normalizedRight[index];
        if (leftCommand.id !== rightCommand.id
            || leftCommand.label !== rightCommand.label
            || leftCommand.description !== rightCommand.description
            || leftCommand.disabled !== rightCommand.disabled
            || leftCommand.reason !== rightCommand.reason
            || JSON.stringify(leftCommand.payload) !== JSON.stringify(rightCommand.payload)) {
            return false;
        }
    }
    return true;
}
function areStringListsEquivalent(left, right) {
    const normalizedLeft = left ?? [];
    const normalizedRight = right ?? [];
    if (normalizedLeft.length !== normalizedRight.length) {
        return false;
    }
    for (let index = 0; index < normalizedLeft.length; index += 1) {
        if (normalizedLeft[index] !== normalizedRight[index]) {
            return false;
        }
    }
    return true;
}
function areProjectedTowersEquivalent(left, right) {
    return left.id === right.id
        && left.type === right.type
        && left.name === right.name
        && left.level === right.level
        && left.status === right.status
        && left.cell.x === right.cell.x
        && left.cell.y === right.cell.y
        && left.footprint.width === right.footprint.width
        && left.footprint.height === right.footprint.height
        && left.range === right.range
        && left.damage === right.damage
        && left.attackRate === right.attackRate
        && left.hp === right.hp
        && left.maxHp === right.maxHp
        && areStringListsEquivalent(left.tags, right.tags)
        && areTowerCommandsEquivalent(left.commands, right.commands);
}
function areProjectedEnemiesEquivalent(left, right) {
    return left.id === right.id
        && left.type === right.type
        && left.name === right.name
        && left.position.x === right.position.x
        && left.position.y === right.position.y
        && left.hp === right.hp
        && left.maxHp === right.maxHp
        && left.threat === right.threat
        && left.count === right.count
        && left.intent === right.intent
        && left.progress === right.progress;
}
function buildEntityDelta(previousEntities, nextEntities, areEquivalent) {
    const previousById = new Map(previousEntities.map((entity) => [entity.id, entity]));
    const nextIds = new Set(nextEntities.map((entity) => entity.id));
    const upsert = [];
    const remove = [];
    for (const entity of nextEntities) {
        const previousEntity = previousById.get(entity.id);
        if (!previousEntity || !areEquivalent(previousEntity, entity)) {
            upsert.push(entity);
        }
    }
    for (const entity of previousEntities) {
        if (!nextIds.has(entity.id)) {
            remove.push(entity.id);
        }
    }
    return { upsert, remove };
}
function buildCells(state) {
    if (cachedMapCellsSource
        && cachedProjectedMapCells
        && areMapCellsEquivalent(cachedMapCellsSource, state.map.cells)) {
        return cachedProjectedMapCells;
    }
    const projectedCells = state.map.cells.map((cell) => ({
        x: cell.x,
        y: cell.y,
        kind: cell.kind,
        walkable: cell.walkable,
        buildable: cell.buildable,
        label: cell.label,
    }));
    cachedMapCellsSource = state.map.cells;
    cachedProjectedMapCells = projectedCells;
    return projectedCells;
}
function buildFrontendBuildPalette() {
    return [];
}
function buildFrontendActionBar() {
    return {
        title: 'PVE V2',
        summary: '使用征兵、部署与神将动作进行战斗。',
        actions: [],
    };
}
function projectFrontendRuntimeState(state, config) {
    const primaryPlayer = state.players[0] ?? null;
    const pveEnemyCount = state.pve?.enemyCount ?? 0;
    const pveCapacity = state.pve?.maxCapacity ?? state.maxCapacity;
    return {
        tick: state.tick,
        status: state.status,
        result: state.result,
        resources: {
            gold: primaryPlayer?.gold ?? config.playerStartingGold,
            mana: 0,
            manaLimit: 100,
            heat: 0,
            heatLimit: 100,
            repair: 0,
            threat: pveEnemyCount * 10,
            fortress: Math.max(0, pveCapacity - pveEnemyCount),
            fortressMax: pveCapacity,
        },
        room: {
            playerCount: state.playerCount,
            enemyCount: pveEnemyCount,
            maxCapacity: pveCapacity,
            overloadTicks: state.overloadTicks,
            overloadCountdownSec: state.overloadCountdownSec,
            totalGold: state.players.reduce((sum, player) => sum + player.gold, 0),
        },
        towers: [],
        enemies: [],
        wave: {
            index: state.wave.index,
            label: `${state.wave.label} · 剩余刷怪 ${state.wave.remainingSpawns}`,
        },
        score: primaryPlayer?.score ?? 0,
        updatedAt: new Date().toISOString(),
        pve: state.pve,
    };
}
function buildFrontendNotices(state) {
    const resultNotice = state.result
        ? state.result.outcome === 'victory'
            ? `战局结束：胜利。${state.result.reason ?? '已清空全部波次。'}`
            : `战局结束：失败。${state.result.reason ?? '场上怪物持续超载。'}`
        : null;
    return state.players.length === 0
        ? ['等待玩家或 Agent 连接网关。']
        : [
            `当前 ${state.playerCount} 人房间，刷怪容量 ${state.pve?.enemyCount ?? 0}/${state.pve?.maxCapacity ?? state.maxCapacity}${state.overloadCountdownSec > 0 ? `，超载倒计时 ${state.overloadCountdownSec}s` : ''}。`,
            ...(resultNotice ? [resultNotice] : []),
        ];
}
function projectFrontendUiState(state, config) {
    return {
        buildPalette: buildFrontendBuildPalette(),
        actionBar: buildFrontendActionBar(),
    };
}
function projectFrontendGameState(state, config) {
    const runtimeState = projectFrontendRuntimeState(state, config);
    const uiState = projectFrontendUiState(state, config);
    return {
        matchId: state.matchId,
        map: {
            width: state.map.width,
            height: state.map.height,
            cells: buildCells(state),
        },
        ...uiState,
        ...runtimeState,
        notices: buildFrontendNotices(state),
    };
}
function projectFrontendGameStatePatch(state, config, previousState) {
    const runtimeState = projectFrontendRuntimeState(state, config);
    const patch = {
        tick: runtimeState.tick,
        status: runtimeState.status,
        result: runtimeState.result,
        resources: runtimeState.resources,
        room: runtimeState.room,
        wave: runtimeState.wave,
        score: runtimeState.score,
        updatedAt: runtimeState.updatedAt,
    };
    if (runtimeState.pve) {
        if (previousState?.pve && previousState.matchId === state.matchId) {
            patch.pvePatch = (0, pve_state_delta_1.createPveMatchStatePatch)(previousState.pve, runtimeState.pve);
        }
        else {
            patch.pve = runtimeState.pve;
        }
    }
    if (!previousState) {
        patch.towers = runtimeState.towers;
        patch.enemies = runtimeState.enemies;
    }
    else {
        const towerDelta = buildEntityDelta(previousState.towers, runtimeState.towers, areProjectedTowersEquivalent);
        if (towerDelta.upsert.length > 0 || towerDelta.remove.length > 0) {
            patch.towerDelta = towerDelta;
        }
        const enemyDelta = buildEntityDelta(previousState.enemies, runtimeState.enemies, areProjectedEnemiesEquivalent);
        if (enemyDelta.upsert.length > 0 || enemyDelta.remove.length > 0) {
            patch.enemyDelta = enemyDelta;
        }
    }
    const projectedMap = {
        width: state.map.width,
        height: state.map.height,
        cells: buildCells(state),
    };
    if (!previousState || !areProjectedMapsEquivalent(previousState.map, projectedMap)) {
        patch.map = projectedMap;
    }
    return patch;
}
function projectFrontendNoticeUpdate(state, previousState) {
    const notices = buildFrontendNotices(state);
    if (previousState && areStringArraysEquivalent(previousState.notices, notices)) {
        return null;
    }
    return { notices };
}
function projectFrontendUiStateUpdate(state, config, previousState) {
    const nextUiState = projectFrontendUiState(state, config);
    const update = {};
    if (!previousState || !areBuildPalettesEquivalent(previousState.buildPalette, nextUiState.buildPalette)) {
        update.buildPalette = nextUiState.buildPalette;
    }
    if (!previousState || !areActionBarsEquivalent(previousState.actionBar, nextUiState.actionBar)) {
        update.actionBar = nextUiState.actionBar;
    }
    return update;
}
