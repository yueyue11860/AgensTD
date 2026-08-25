"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FULL_BUILD_SUPPORT_LOADOUTS = exports.FULL_BUILD_BOT_ARCHETYPES = void 0;
exports.simulateRuntimeFullBuild = simulateRuntimeFullBuild;
exports.summarizeRuntimeFullBuildRuns = summarizeRuntimeFullBuildRuns;
exports.runRuntimeFullBuildMatrixRuns = runRuntimeFullBuildMatrixRuns;
exports.runRuntimeFullBuildMatrixPoint = runRuntimeFullBuildMatrixPoint;
exports.runPureSoldierMatrixPoint = runPureSoldierMatrixPoint;
exports.assertBaseEconomyStillIntact = assertBaseEconomyStillIntact;
const roster_1 = require("../core/hero-v1/roster");
const item_v1_1 = require("../item-v1");
const weapon_v1_1 = require("../weapon-v1");
const arena_1 = require("./arena");
const balance_simulator_1 = require("./balance-simulator");
const economy_1 = require("./economy");
const runtime_1 = require("./runtime");
const catalogs_1 = require("./catalogs");
exports.FULL_BUILD_BOT_ARCHETYPES = [
    { archetypeId: 'blade_single', preferredSoldierType: 'blade' },
    { archetypeId: 'spear_pierce', preferredSoldierType: 'spear' },
    { archetypeId: 'bow_cleanup', preferredSoldierType: 'bow' },
    { archetypeId: 'cavalry_aoe', preferredSoldierType: 'cavalry' },
];
/**
 * 四套真实支援构筑在每种天兵 archetype 中等频轮换。
 * 这样神将/羁绊/装备强度不会被误算为某个兵种的强度。
 */
exports.FULL_BUILD_SUPPORT_LOADOUTS = [
    { loadoutId: 'physical_duo', generalIds: ['yangjian', 'houyi'], combatPassiveItemId: 'army_breaking_banner' },
    { loadoutId: 'thunder_duo', generalIds: ['lei_gong', 'dian_mu'], combatPassiveItemId: 'mystic_method_seal' },
    { loadoutId: 'summon_duo', generalIds: ['lijing', 'chang_e'], combatPassiveItemId: 'myriad_spirit_banner' },
    { loadoutId: 'lotus_duo', generalIds: ['lijing', 'nazha'], combatPassiveItemId: 'army_breaking_banner' },
];
const COMMON_WEAPONS_BY_ARCHETYPE = {
    physical: 'qinggang_blade',
    magic: 'peachwood_staff',
    summon: 'spirit_bell',
    control: 'binding_rope',
};
const EXCLUSIVE_WEAPON_BY_GENERAL = {
    yangjian: 'yangjian_divine_trident', houyi: 'houyi_sun_shooting_bow',
    lei_gong: 'lei_gong_thunder_chisel', dian_mu: 'dian_mu_lightning_mirror',
    lijing: 'lijing_pagoda', chang_e: 'chang_e_guanghan_moonwheel', nazha: 'nazha_fire_tip_spear',
    shou_xing: 'shouxing_longevity_staff',
};
const FORMATION_STARTS = [{ x: 8, y: 16 }, { x: 11, y: 16 }];
const SOLDIER_CELLS = [
    // 沿 P1 实际路径的前半圈分散覆盖，避免把单波近出生点 DPS 伪装成整圈火力。
    { x: 14, y: 18 }, { x: 10, y: 17 }, { x: 6, y: 18 }, { x: 6, y: 20 },
    { x: 10, y: 20 }, { x: 15, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 17 },
    { x: 20, y: 13 }, { x: 20, y: 9 }, { x: 17, y: 8 }, { x: 12, y: 8 },
    { x: 8, y: 8 }, { x: 6, y: 10 },
].filter(cell => (0, arena_1.isDefaultDeployableCell)('P1', cell.x, cell.y));
function itemSnapshot(playerId, combatPassiveItemId) {
    const activeSlots = ['cultivation_pill', 'heavenly_thunder_order'];
    const passiveSlots = [
        'traveling_kitchen', 'frugal_recruitment_order', 'talent_registry',
        'talent_pity_order', 'army_expansion_order', combatPassiveItemId,
    ];
    return {
        snapshotVersion: 1,
        catalogVersion: 1,
        playerId,
        accountVersion: 1,
        activeSlots,
        passiveSlots,
        activeItems: activeSlots.map(id => (0, item_v1_1.getActiveItemDefinition)(id)),
        passiveItems: passiveSlots.map(id => (0, item_v1_1.getPassiveItemDefinition)(id)),
    };
}
function weaponSnapshot(playerId, generalIds) {
    return {
        snapshotVersion: 1,
        playerId,
        accountVersion: 1,
        byGeneralId: Object.fromEntries(generalIds.map((generalId) => {
            const general = (0, roster_1.getGeneralRosterEntry)(generalId);
            if (!general)
                throw new Error(`Unknown general: ${generalId}`);
            const ids = [COMMON_WEAPONS_BY_ARCHETYPE[general.profession], EXCLUSIVE_WEAPON_BY_GENERAL[generalId]];
            if (!ids[1])
                throw new Error(`Missing full-build exclusive weapon: ${generalId}`);
            return [generalId, {
                    slots: ids,
                    resolvedDefinitions: ids.map(id => (0, weapon_v1_1.getWeaponDefinition)(id)),
                }];
        })),
    };
}
function characterPlan(loadout) {
    const characterTokens = {};
    const cellByGlyph = new Map();
    loadout.generalIds.forEach((generalId, generalIndex) => {
        const general = (0, roster_1.getGeneralRosterEntry)(generalId);
        if (!general)
            throw new Error(`Unknown general: ${generalId}`);
        general.glyphs.forEach((glyph, glyphIndex) => {
            characterTokens[glyph] = (characterTokens[glyph] ?? 0) + 1;
            const start = FORMATION_STARTS[generalIndex];
            const cell = { x: start.x + glyphIndex, y: start.y };
            if (!(0, arena_1.isDefaultDeployableCell)('P1', cell.x, cell.y)) {
                throw new Error(`Non-deployable formation cell: ${generalId}:${cell.x},${cell.y}`);
            }
            cellByGlyph.set(glyph, cell);
        });
    });
    return { characterTokens, cellByGlyph };
}
function percentile(sorted, ratio) {
    if (sorted.length === 0)
        return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}
function mutableContribution() {
    return { actualDamage: 0, hitCount: 0, uniqueTargetIds: new Set(), kills: 0,
        controlApplications: 0, controlDurationTicks: 0, overkillDamage: 0,
        rangeReadyTicks: 0, rangeOpportunityTicks: 0 };
}
function frozenContribution(source) {
    return {
        actualDamage: source.actualDamage,
        hitCount: source.hitCount,
        uniqueTargetCount: source.uniqueTargetIds.size,
        kills: source.kills,
        controlApplications: source.controlApplications,
        controlDurationTicks: source.controlDurationTicks,
        overkillDamage: source.overkillDamage,
        rangeReadyTicks: source.rangeReadyTicks,
        rangeOpportunityTicks: source.rangeOpportunityTicks,
        rangeUptimeBps: Math.floor(source.rangeReadyTicks * 10_000 / Math.max(1, source.rangeOpportunityTicks)),
    };
}
function aggregateContributionMaps(maps) {
    const totals = new Map();
    for (const map of maps)
        for (const [sourceId, contribution] of Object.entries(map)) {
            const previous = totals.get(sourceId);
            const rangeReadyTicks = (previous?.rangeReadyTicks ?? 0) + contribution.rangeReadyTicks;
            const rangeOpportunityTicks = (previous?.rangeOpportunityTicks ?? 0) + contribution.rangeOpportunityTicks;
            totals.set(sourceId, {
                actualDamage: (previous?.actualDamage ?? 0) + contribution.actualDamage,
                hitCount: (previous?.hitCount ?? 0) + contribution.hitCount,
                uniqueTargetCount: (previous?.uniqueTargetCount ?? 0) + contribution.uniqueTargetCount,
                kills: (previous?.kills ?? 0) + contribution.kills,
                controlApplications: (previous?.controlApplications ?? 0) + contribution.controlApplications,
                controlDurationTicks: (previous?.controlDurationTicks ?? 0) + contribution.controlDurationTicks,
                overkillDamage: (previous?.overkillDamage ?? 0) + contribution.overkillDamage,
                rangeReadyTicks,
                rangeOpportunityTicks,
                rangeUptimeBps: Math.floor(rangeReadyTicks * 10_000 / Math.max(1, rangeOpportunityTicks)),
            });
        }
    return Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
/**
 * 消费 Runtime 的真实伤害事件和每 tick 快照，不参与战斗决策。
 * 羁绊/武器数据表示“该来源启用时关联的实际伤害”，与神将数据重叠，不可相加。
 */
class RuntimeContributionAudit {
    soldiers = new Map();
    generals = new Map();
    synergies = new Map();
    weapons = new Map();
    activeItems = new Map();
    soldierTypeByPieceId = new Map();
    synergyGeneralIds = new Map();
    weaponIdsByGeneralId = new Map();
    seenStatusIds = new Set();
    lastRangeTick = -1;
    totalActualDamage = 0;
    constructor(loadout) {
        for (const type of catalogs_1.SOLDIER_TYPES)
            this.soldiers.set(type, mutableContribution());
        for (const generalId of loadout.generalIds) {
            this.generals.set(generalId, mutableContribution());
            const general = (0, roster_1.getGeneralRosterEntry)(generalId);
            const weaponIds = [COMMON_WEAPONS_BY_ARCHETYPE[general.profession], EXCLUSIVE_WEAPON_BY_GENERAL[generalId]];
            this.weaponIdsByGeneralId.set(generalId, weaponIds);
            for (const weaponId of weaponIds)
                this.weapons.set(weaponId, mutableContribution());
        }
        this.activeItems.set('cultivation_pill', mutableContribution());
        this.activeItems.set('heavenly_thunder_order', mutableContribution());
    }
    onEvent(event) {
        if (event.type !== 'DAMAGE_APPLIED')
            return;
        const enemyId = String(event.data.enemyId ?? '');
        if (!enemyId)
            return;
        const hpBefore = Number(event.data.hpBefore ?? 0);
        const hpAfter = Number(event.data.hpAfter ?? hpBefore);
        const reportedDamage = Number(event.data.finalDamage ?? event.data.damage ?? Math.max(0, hpBefore - hpAfter));
        const actualDamage = Math.max(0, hpBefore - hpAfter);
        const overkillDamage = Math.max(0, reportedDamage - actualDamage);
        this.totalActualDamage += actualDamage;
        const attackerId = String(event.data.attackerId ?? '');
        const soldierType = this.soldierTypeByPieceId.get(attackerId);
        if (soldierType) {
            this.recordDamage(this.soldiers.get(soldierType), enemyId, actualDamage, overkillDamage, hpAfter === 0);
            return;
        }
        const generalId = String(event.data.generalId ?? '');
        if (generalId === 'active_item' || event.data.actionKind === 'active_item') {
            this.recordDamage(this.activeItems.get('heavenly_thunder_order'), enemyId, actualDamage, overkillDamage, hpAfter === 0);
            return;
        }
        if (!generalId)
            return;
        this.recordGeneralAssociatedDamage(generalId, enemyId, actualDamage, overkillDamage, hpAfter === 0);
    }
    observe(snapshot, playerId) {
        const player = snapshot.players.find(candidate => candidate.playerId === playerId);
        if (!player)
            return;
        for (const entry of player.boardPieces) {
            if (entry.piece.kind === 'soldier')
                this.soldierTypeByPieceId.set(entry.piece.id, entry.piece.soldierType);
        }
        for (const synergy of player.activeSynergies) {
            if (!this.synergies.has(synergy.synergyId))
                this.synergies.set(synergy.synergyId, mutableContribution());
            this.synergyGeneralIds.set(synergy.synergyId, new Set(synergy.contributingGeneralIds));
        }
        for (const status of snapshot.statuses) {
            if (this.seenStatusIds.has(status.instanceId))
                continue;
            this.seenStatusIds.add(status.instanceId);
            if (!['slow', 'stun', 'root', 'suppress', 'suppress_active_trait'].includes(status.statusId))
                continue;
            const duration = Math.max(0, status.expiresAtTick - status.appliedAtTick);
            if (status.sourceGeneralId === 'active_item') {
                this.recordControl(this.activeItems.get('heavenly_thunder_order'), duration);
            }
            else {
                const general = this.generals.get(status.sourceGeneralId);
                if (general)
                    this.recordControl(general, duration);
                for (const [synergyId, generalIds] of this.synergyGeneralIds) {
                    if (generalIds.has(status.sourceGeneralId))
                        this.recordControl(this.synergies.get(synergyId), duration);
                }
                for (const weaponId of this.weaponIdsByGeneralId.get(status.sourceGeneralId) ?? []) {
                    this.recordControl(this.weapons.get(weaponId), duration);
                }
            }
        }
        if (snapshot.tick === this.lastRangeTick)
            return;
        this.lastRangeTick = snapshot.tick;
        const targets = snapshot.enemies.filter(enemy => !enemy.spawnProtected && !enemy.invulnerable);
        if (targets.length === 0)
            return;
        for (const entry of player.boardPieces) {
            if (entry.piece.kind !== 'soldier')
                continue;
            const contribution = this.soldiers.get(entry.piece.soldierType);
            contribution.rangeOpportunityTicks += 1;
            const range = (0, catalogs_1.getSoldierLevelValue)((0, catalogs_1.getSoldierCatalogEntry)(entry.piece.soldierType).attackRangeMilliCellsByLevel, entry.piece.level);
            if (targets.some(enemy => distanceSquared(entry.x * 1000, entry.y * 1000, enemy.xMilli, enemy.yMilli) <= range ** 2)) {
                contribution.rangeReadyTicks += 1;
            }
        }
        for (const formation of player.generalFormations) {
            const progress = player.generalProgress.find(candidate => candidate.generalId === formation.generalId);
            const contribution = this.generals.get(formation.generalId);
            if (!progress || !contribution)
                continue;
            contribution.rangeOpportunityTicks += 1;
            if (targets.some(enemy => distanceSquared(formation.anchorXMilli, formation.anchorYMilli, enemy.xMilli, enemy.yMilli) <= progress.attackRangeMilliCells ** 2))
                contribution.rangeReadyTicks += 1;
        }
    }
    report() {
        return {
            attributionSemantics: 'overlapping_association_not_additive',
            totalActualDamage: this.totalActualDamage,
            soldiers: this.freezeMap(this.soldiers),
            generals: this.freezeMap(this.generals),
            synergies: this.freezeMap(this.synergies),
            weapons: this.freezeMap(this.weapons),
            activeItems: this.freezeMap(this.activeItems),
        };
    }
    recordGeneralAssociatedDamage(generalId, enemyId, actualDamage, overkillDamage, killed) {
        const general = this.generals.get(generalId);
        if (general)
            this.recordDamage(general, enemyId, actualDamage, overkillDamage, killed);
        for (const [synergyId, generalIds] of this.synergyGeneralIds) {
            if (generalIds.has(generalId))
                this.recordDamage(this.synergies.get(synergyId), enemyId, actualDamage, overkillDamage, killed);
        }
        for (const weaponId of this.weaponIdsByGeneralId.get(generalId) ?? []) {
            this.recordDamage(this.weapons.get(weaponId), enemyId, actualDamage, overkillDamage, killed);
        }
    }
    recordDamage(target, enemyId, actualDamage, overkillDamage, killed) {
        target.actualDamage += actualDamage;
        target.hitCount += 1;
        target.uniqueTargetIds.add(enemyId);
        target.overkillDamage += overkillDamage;
        if (killed)
            target.kills += 1;
    }
    recordControl(target, durationTicks) {
        target.controlApplications += 1;
        target.controlDurationTicks += durationTicks;
    }
    freezeMap(source) {
        return Object.fromEntries([...source.entries()].sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, frozenContribution(value)]));
    }
}
function distanceSquared(leftX, leftY, rightX, rightY) {
    const dx = leftX - rightX;
    const dy = leftY - rightY;
    return dx * dx + dy * dy;
}
class RuntimeBuildBot {
    runtime;
    playerId;
    archetype;
    cellByGlyph;
    generalCount;
    audit;
    actionSequence = 0;
    deployedPieceIds = new Set();
    usedActiveItemIds = new Set();
    formedGeneralIds = new Set();
    activatedSynergyIds = new Set();
    trayNeedsProcessing = false;
    soldierDeploymentsByType = { blade: 0, spear: 0, bow: 0, cavalry: 0 };
    constructor(runtime, playerId, archetype, cellByGlyph, generalCount, audit) {
        this.runtime = runtime;
        this.playerId = playerId;
        this.archetype = archetype;
        this.cellByGlyph = cellByGlyph;
        this.generalCount = generalCount;
        this.audit = audit;
    }
    observe(snapshot = this.runtime.snapshot()) {
        this.audit.observe(snapshot, this.playerId);
        const player = snapshot.players.find(candidate => candidate.playerId === this.playerId);
        if (!player)
            return;
        for (const entry of player.boardPieces) {
            if (entry.piece.kind !== 'soldier' || this.deployedPieceIds.has(entry.piece.id))
                continue;
            this.deployedPieceIds.add(entry.piece.id);
            this.soldierDeploymentsByType[entry.piece.soldierType] += 1;
        }
        for (const formation of player.generalFormations)
            this.formedGeneralIds.add(formation.generalId);
        for (const synergy of player.activeSynergies)
            this.activatedSynergyIds.add(synergy.synergyId);
        for (const slot of player.itemRuntime?.slots ?? []) {
            if (slot && slot.usesThisMatch > 0)
                this.usedActiveItemIds.add(slot.itemId);
        }
    }
    act() {
        for (let batch = 0; batch < 12; batch += 1) {
            if (this.trayNeedsProcessing) {
                this.deployCharacters();
                this.mergeSoldiers();
                this.deploySoldiers();
                this.mergeSoldiers();
                this.trayNeedsProcessing = false;
                this.observe();
            }
            const player = this.player();
            if (player.rice < player.nextRecruitCost)
                break;
            this.requireOk(this.runtime.handleAction(this.playerId, {
                type: 'RECRUIT_BATCH', actionId: this.actionId('recruit'), expectedTrayRevision: player.trayRevision,
            }), 'recruit');
            this.trayNeedsProcessing = true;
        }
        this.useActiveItems();
        this.observe();
    }
    resultSets() {
        return {
            formedGeneralIds: [...this.formedGeneralIds].sort(),
            activatedSynergyIds: [...this.activatedSynergyIds].sort(),
            usedActiveItemIds: [...this.usedActiveItemIds].sort(),
        };
    }
    player() {
        const player = this.runtime.snapshot().players.find(candidate => candidate.playerId === this.playerId);
        if (!player)
            throw new Error(`Missing bot player: ${this.playerId}`);
        return player;
    }
    deployCharacters() {
        for (const [glyph, cell] of this.cellByGlyph) {
            const player = this.player();
            if (player.boardPieces.some(entry => entry.piece.kind === 'character' && entry.piece.glyph === glyph))
                continue;
            const trayIndex = player.tray.findIndex(piece => piece?.kind === 'character' && piece.glyph === glyph);
            if (trayIndex < 0)
                continue;
            if (player.boardPieces.some(entry => entry.x === cell.x && entry.y === cell.y))
                continue;
            this.requireOk(this.runtime.handleAction(this.playerId, {
                type: 'SWAP_TRAY_BOARD', actionId: this.actionId(`deploy-${glyph}`), trayIndex,
                boardX: cell.x, boardY: cell.y, expectedTrayRevision: player.trayRevision,
                expectedBoardRevision: player.boardRevision,
            }), `deploy character ${glyph}`);
        }
    }
    mergeSoldiers() {
        for (let merge = 0; merge < 80; merge += 1) {
            const player = this.player();
            const soldiers = this.allSoldiers(player);
            let pair = null;
            for (const type of catalogs_1.SOLDIER_TYPES) {
                for (const level of [1, 2, 3, 4]) {
                    const matching = soldiers.filter(piece => piece.soldierType === type && piece.level === level);
                    if (matching.length >= 2) {
                        const boardIds = new Set(player.boardPieces.map(entry => entry.piece.id));
                        matching.sort((left, right) => Number(boardIds.has(right.id)) - Number(boardIds.has(left.id))
                            || left.createdSequence - right.createdSequence);
                        pair = [matching[1], matching[0]];
                        break;
                    }
                }
                if (pair)
                    break;
            }
            if (!pair)
                return;
            this.requireOk(this.runtime.handleAction(this.playerId, {
                type: 'MERGE_SOLDIERS', actionId: this.actionId('merge'), sourcePieceId: pair[0].id,
                targetPieceId: pair[1].id, expectedTrayRevision: player.trayRevision,
                expectedReserveRevision: player.reserveRevision, expectedBoardRevision: player.boardRevision,
            }), 'merge soldiers');
        }
        throw new Error('Bot merge loop exceeded safety bound');
    }
    deploySoldiers() {
        for (let deployment = 0; deployment < 12; deployment += 1) {
            const player = this.player();
            const maximumSoldierPopulation = player.populationCap - this.generalCount;
            const deployedSoldiers = player.boardPieces.filter((entry) => entry.piece.kind === 'soldier');
            if (deployedSoldiers.length >= maximumSoldierPopulation)
                return;
            const desiredCounts = { blade: 1, spear: 1, bow: 1, cavalry: 1 };
            desiredCounts[this.archetype.preferredSoldierType] = Math.max(1, maximumSoldierPopulation - 3);
            const deployedCounts = { blade: 0, spear: 0, bow: 0, cavalry: 0 };
            for (const entry of deployedSoldiers)
                deployedCounts[entry.piece.soldierType] += 1;
            const candidates = player.tray.map((piece, trayIndex) => ({ piece, trayIndex }))
                .filter((entry) => entry.piece?.kind === 'soldier')
                .filter(entry => deployedCounts[entry.piece.soldierType] < desiredCounts[entry.piece.soldierType])
                .sort((left, right) => (Number(right.piece.soldierType === this.archetype.preferredSoldierType)
                - Number(left.piece.soldierType === this.archetype.preferredSoldierType)
                || right.piece.level - left.piece.level
                || left.piece.createdSequence - right.piece.createdSequence));
            const candidate = candidates[0];
            if (!candidate)
                return;
            const occupied = new Set(player.boardPieces.map(entry => `${entry.x},${entry.y}`));
            const cell = this.orderedSoldierCells(candidate.piece.soldierType).find(entry => !occupied.has(`${entry.x},${entry.y}`));
            if (!cell)
                return;
            this.requireOk(this.runtime.handleAction(this.playerId, {
                type: 'SWAP_TRAY_BOARD', actionId: this.actionId('deploy-soldier'), trayIndex: candidate.trayIndex,
                boardX: cell.x, boardY: cell.y, expectedTrayRevision: player.trayRevision,
                expectedBoardRevision: player.boardRevision,
            }), 'deploy soldier');
        }
    }
    orderedSoldierCells(type) {
        if (type === 'spear')
            return [...SOLDIER_CELLS].sort((left, right) => Math.abs(left.y - 18) - Math.abs(right.y - 18));
        return SOLDIER_CELLS;
    }
    useActiveItems() {
        let snapshot = this.runtime.snapshot();
        if (snapshot.status !== 'running')
            return;
        let player = snapshot.players.find(candidate => candidate.playerId === this.playerId);
        const pill = player.itemRuntime?.slots[0];
        const general = player.generalFormations[0];
        if (pill?.itemId === 'cultivation_pill' && pill.enabled && pill.chargesRemaining > 0
            && pill.cooldownEndsAtTick <= snapshot.tick && general) {
            this.requireOk(this.runtime.handleAction(this.playerId, {
                type: 'USE_ACTIVE_ITEM', actionId: this.actionId('pill'), requestId: this.actionId('pill-request'),
                slotIndex: 0, itemId: pill.itemId, target: { kind: 'general', generalId: general.generalId },
                expectedItemRuntimeVersion: player.itemRuntime.version,
            }), 'use cultivation pill');
        }
        snapshot = this.runtime.snapshot();
        player = snapshot.players.find(candidate => candidate.playerId === this.playerId);
        const thunder = player.itemRuntime?.slots[1];
        const enemy = snapshot.enemies.find(candidate => !candidate.spawnProtected && !candidate.invulnerable);
        if (snapshot.wave.phase !== 'prep' && thunder?.itemId === 'heavenly_thunder_order'
            && thunder.enabled && thunder.chargesRemaining > 0
            && thunder.cooldownEndsAtTick <= snapshot.tick && enemy) {
            this.requireOk(this.runtime.handleAction(this.playerId, {
                type: 'USE_ACTIVE_ITEM', actionId: this.actionId('thunder'), requestId: this.actionId('thunder-request'),
                slotIndex: 1, itemId: thunder.itemId,
                target: { kind: 'battlefield_point', xMilli: enemy.xMilli, yMilli: enemy.yMilli },
                expectedItemRuntimeVersion: player.itemRuntime.version,
            }), 'use thunder order');
        }
    }
    allSoldiers(player) {
        return [
            ...player.tray.filter((piece) => piece?.kind === 'soldier'),
            ...player.reserve.filter((piece) => piece?.kind === 'soldier'),
            ...player.boardPieces.flatMap(entry => entry.piece.kind === 'soldier' ? [entry.piece] : []),
        ];
    }
    actionId(prefix) {
        this.actionSequence += 1;
        return `bot-${prefix}-${this.actionSequence}`;
    }
    requireOk(result, operation) {
        if (!result.ok)
            throw new Error(`Full-build bot failed to ${operation}: ${result.code}`);
    }
}
function simulateRuntimeFullBuild(seed, levelId, difficulty, archetypeId, maximumTicks = 12_000, supportLoadoutId = exports.FULL_BUILD_SUPPORT_LOADOUTS[0].loadoutId) {
    const archetype = exports.FULL_BUILD_BOT_ARCHETYPES.find(candidate => candidate.archetypeId === archetypeId);
    if (!archetype)
        throw new Error(`Unknown full-build archetype: ${archetypeId}`);
    const supportLoadout = exports.FULL_BUILD_SUPPORT_LOADOUTS.find(candidate => candidate.loadoutId === supportLoadoutId);
    if (!supportLoadout)
        throw new Error(`Unknown full-build support loadout: ${supportLoadoutId}`);
    const playerId = 'balance-bot';
    const plan = characterPlan(supportLoadout);
    const audit = new RuntimeContributionAudit(supportLoadout);
    const runtime = new runtime_1.PveGameRuntime({
        seed, levelId, difficulty, tickRateMs: 100, maxWaves: 20,
        characterTokens: plan.characterTokens, eventHistoryLimit: 30,
        itemLoadoutSnapshots: { [playerId]: itemSnapshot(playerId, supportLoadout.combatPassiveItemId) },
        weaponLoadoutSnapshots: { [playerId]: weaponSnapshot(playerId, supportLoadout.generalIds) },
        eventObserver: event => audit.onEvent(event),
    });
    runtime.registerPlayer(playerId, 'P1');
    const bot = new RuntimeBuildBot(runtime, playerId, archetype, plan.cellByGlyph, supportLoadout.generalIds.length, audit);
    bot.act();
    runtime.start();
    let snapshot = runtime.snapshot();
    for (let tick = 0; tick < maximumTicks && snapshot.status !== 'finished'; tick += 1) {
        snapshot = runtime.tick();
        bot.observe(snapshot);
        if (snapshot.status === 'finished')
            break;
        bot.act();
        snapshot = runtime.snapshot();
    }
    bot.observe(snapshot);
    const player = snapshot.players[0];
    const resultSets = bot.resultSets();
    return {
        seed, levelId, difficulty, archetypeId, supportLoadoutId,
        outcome: snapshot.status !== 'finished' ? 'timeout' : snapshot.result?.outcome ?? 'defeat',
        highestClearedWave: Math.max(0, ...player.clearedWaves),
        recruitBatches: player.recruitCount,
        soldierDeploymentsByType: { ...bot.soldierDeploymentsByType },
        ...resultSets,
        contribution: audit.report(),
        ticks: snapshot.tick,
    };
}
function summarizeRuntimeFullBuildRuns(levelId, difficulty, runs) {
    if (runs.length === 0)
        throw new Error('Cannot summarize zero full-build runs');
    const highest = runs.map(run => run.highestClearedWave).sort((left, right) => left - right);
    const victories = runs.filter(run => run.outcome === 'victory');
    const deploymentTotals = { blade: 0, spear: 0, bow: 0, cavalry: 0 };
    const damageTotals = { blade: 0, spear: 0, bow: 0, cavalry: 0 };
    const rangeReadyTotals = { blade: 0, spear: 0, bow: 0, cavalry: 0 };
    const rangeOpportunityTotals = { blade: 0, spear: 0, bow: 0, cavalry: 0 };
    for (const run of victories)
        for (const type of catalogs_1.SOLDIER_TYPES)
            deploymentTotals[type] += run.soldierDeploymentsByType[type];
    for (const run of victories)
        for (const type of catalogs_1.SOLDIER_TYPES) {
            const contribution = run.contribution.soldiers[type];
            damageTotals[type] += contribution.actualDamage;
            rangeReadyTotals[type] += contribution.rangeReadyTicks;
            rangeOpportunityTotals[type] += contribution.rangeOpportunityTicks;
        }
    const allDeployments = Object.values(deploymentTotals).reduce((sum, count) => sum + count, 0);
    const allSoldierDamage = Object.values(damageTotals).reduce((sum, damage) => sum + damage, 0);
    const archetypeClearRateBps = Object.fromEntries(exports.FULL_BUILD_BOT_ARCHETYPES.map(archetype => {
        const archetypeRuns = runs.filter(run => run.archetypeId === archetype.archetypeId);
        return [archetype.archetypeId, Math.floor(archetypeRuns.filter(run => run.outcome === 'victory').length * 10_000
                / Math.max(1, archetypeRuns.length))];
    }));
    const victoriesByArchetype = exports.FULL_BUILD_BOT_ARCHETYPES.map(archetype => (victories.filter(run => run.archetypeId === archetype.archetypeId).length));
    const supportLoadoutClearRateBps = Object.fromEntries(exports.FULL_BUILD_SUPPORT_LOADOUTS.map(loadout => {
        const loadoutRuns = runs.filter(run => run.supportLoadoutId === loadout.loadoutId);
        return [loadout.loadoutId, Math.floor(loadoutRuns.filter(run => run.outcome === 'victory').length * 10_000
                / Math.max(1, loadoutRuns.length))];
    }));
    return {
        levelId, difficulty, runs: runs.length,
        clearRateBps: Math.floor(victories.length * 10_000 / runs.length),
        medianHighestClearedWave: percentile(highest, 0.5),
        p90HighestClearedWave: percentile(highest, 0.9),
        averageRecruitBatchesMilli: Math.floor(runs.reduce((sum, run) => sum + run.recruitBatches, 0) * 1000 / runs.length),
        soldierDeploymentShareBps: Object.fromEntries(catalogs_1.SOLDIER_TYPES.map(type => [type,
            Math.floor(deploymentTotals[type] * 10_000 / Math.max(1, allDeployments))])),
        soldierDamageShareBps: Object.fromEntries(catalogs_1.SOLDIER_TYPES.map(type => [type,
            Math.floor(damageTotals[type] * 10_000 / Math.max(1, allSoldierDamage))])),
        soldierEffectiveContributionShareBps: Object.fromEntries(catalogs_1.SOLDIER_TYPES.map(type => [type,
            Math.floor(damageTotals[type] * 10_000 / Math.max(1, allSoldierDamage))])),
        soldierRangeUptimeBps: Object.fromEntries(catalogs_1.SOLDIER_TYPES.map(type => [type,
            Math.floor(rangeReadyTotals[type] * 10_000 / Math.max(1, rangeOpportunityTotals[type]))])),
        archetypeClearRateBps,
        supportLoadoutClearRateBps,
        topArchetypeVictoryShareBps: Math.floor(Math.max(0, ...victoriesByArchetype) * 10_000 / Math.max(1, victories.length)),
        formedTwoGeneralsRateBps: Math.floor(runs.filter(run => run.formedGeneralIds.length >= 2).length * 10_000 / runs.length),
        synergyActivationRateBps: Math.floor(runs.filter(run => run.activatedSynergyIds.length >= 1).length * 10_000 / runs.length),
        auditedContributionTotals: {
            generals: aggregateContributionMaps(runs.map(run => run.contribution.generals)),
            synergies: aggregateContributionMaps(runs.map(run => run.contribution.synergies)),
            weapons: aggregateContributionMaps(runs.map(run => run.contribution.weapons)),
            activeItems: aggregateContributionMaps(runs.map(run => run.contribution.activeItems)),
        },
    };
}
function runRuntimeFullBuildMatrixRuns(levelId, difficulty, seedsPerArchetype, seedPrefix = 'full-build-balance') {
    return exports.FULL_BUILD_BOT_ARCHETYPES.flatMap(archetype => Array.from({ length: seedsPerArchetype }, (_, index) => (simulateRuntimeFullBuild(`${seedPrefix}:${difficulty}:${levelId}:${archetype.archetypeId}:${index}`, levelId, difficulty, archetype.archetypeId, 12_000, exports.FULL_BUILD_SUPPORT_LOADOUTS[index % exports.FULL_BUILD_SUPPORT_LOADOUTS.length].loadoutId))));
}
function runRuntimeFullBuildMatrixPoint(levelId, difficulty, seedsPerArchetype, seedPrefix = 'full-build-balance') {
    const runs = runRuntimeFullBuildMatrixRuns(levelId, difficulty, seedsPerArchetype, seedPrefix);
    return summarizeRuntimeFullBuildRuns(levelId, difficulty, runs);
}
function runPureSoldierMatrixPoint(levelId, difficulty, runs, seedPrefix = 'pure-soldier-matrix') {
    const results = Array.from({ length: runs }, (_, index) => ((0, balance_simulator_1.simulatePureSoldierEconomyRun)(`${seedPrefix}:${difficulty}:${levelId}:${index}`, levelId, difficulty)));
    const highest = results.map(result => result.highestClearedWave).sort((left, right) => left - right);
    const stackTotals = { blade: 0, spear: 0, bow: 0, cavalry: 0 };
    for (const result of results)
        for (const stack of result.finalArmy)
            stackTotals[stack.soldierType] += stack.count;
    const allStacks = Object.values(stackTotals).reduce((sum, count) => sum + count, 0);
    return {
        levelId, difficulty, runs,
        clearRateBps: Math.floor(results.filter(result => result.highestClearedWave >= 20).length * 10_000 / runs),
        medianHighestClearedWave: percentile(highest, 0.5),
        p90HighestClearedWave: percentile(highest, 0.9),
        averageRecruitBatchesMilli: Math.floor(results.reduce((sum, result) => sum + result.recruitBatches, 0) * 1000 / runs),
        soldierFinalStackShareBps: Object.fromEntries(catalogs_1.SOLDIER_TYPES.map(type => [type,
            Math.floor(stackTotals[type] * 10_000 / Math.max(1, allStacks))])),
    };
}
function assertBaseEconomyStillIntact() {
    if ((0, economy_1.resolvePvePaidRecruitBaseCost)(0) !== 5 || (0, economy_1.resolvePvePaidRecruitBaseCost)(3) !== 6) {
        throw new Error('Full-build simulator observed a changed base recruit curve');
    }
}
