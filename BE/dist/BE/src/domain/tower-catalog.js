"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.towerCatalog = exports.TOWER_CONFIG = void 0;
exports.getTowerCatalogEntryById = getTowerCatalogEntryById;
exports.getTowerCatalogEntry = getTowerCatalogEntry;
exports.getNextTowerCatalogEntry = getNextTowerCatalogEntry;
exports.getNextTowerCatalogEntryById = getNextTowerCatalogEntryById;
exports.parseTowerCatalogSelection = parseTowerCatalogSelection;
function toTowerConfigId(kind, level) {
    return `${kind}:${level}`;
}
function shotsPerSecondToTicks(shotsPerSecond) {
    return 10 / shotsPerSecond;
}
function buildEntry(config) {
    const id = toTowerConfigId(config.kind, config.level);
    return {
        ...config,
        id,
        type: id,
        label: `${config.kind} ${config.level}级`,
    };
}
exports.TOWER_CONFIG = {
    [toTowerConfigId('箭塔', 1)]: buildEntry({
        kind: '箭塔',
        level: 1,
        description: '标准单体输出塔。',
        cost: 1,
        width: 1,
        height: 1,
        behavior: { kind: 'single-target' },
        attackEffects: [],
        damage: 10,
        range: 3.5,
        fireRateTicks: shotsPerSecondToTicks(1),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('箭塔', 2)]: buildEntry({
        kind: '箭塔',
        level: 2,
        description: '强化后的单体输出塔。',
        cost: 2,
        width: 1,
        height: 1,
        behavior: { kind: 'single-target' },
        attackEffects: [],
        damage: 15,
        range: 3.5,
        fireRateTicks: shotsPerSecondToTicks(1.2),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('箭塔', 3)]: buildEntry({
        kind: '箭塔',
        level: 3,
        description: '高攻速高伤的基础箭塔。',
        cost: 4,
        width: 1,
        height: 1,
        behavior: { kind: 'single-target' },
        attackEffects: [],
        damage: 20,
        range: 3.5,
        fireRateTicks: shotsPerSecondToTicks(1.5),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('冰塔', 1)]: buildEntry({
        kind: '冰塔',
        level: 1,
        description: '单体减速塔。',
        cost: 2,
        width: 1,
        height: 1,
        behavior: { kind: 'single-target' },
        attackEffects: [{ kind: 'slow', remainingDurationMs: 500, speedMultiplier: 0.8 }],
        damage: 8,
        range: 3.5,
        fireRateTicks: shotsPerSecondToTicks(1),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('冰塔', 2)]: buildEntry({
        kind: '冰塔',
        level: 2,
        description: '更强的单体减速塔。',
        cost: 4,
        width: 1,
        height: 1,
        behavior: { kind: 'single-target' },
        attackEffects: [{ kind: 'slow', remainingDurationMs: 700, speedMultiplier: 0.7 }],
        damage: 10,
        range: 3.5,
        fireRateTicks: shotsPerSecondToTicks(1.2),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('冰塔', 3)]: buildEntry({
        kind: '冰塔',
        level: 3,
        description: '强减速单体控制塔。',
        cost: 8,
        width: 1,
        height: 1,
        behavior: { kind: 'single-target' },
        attackEffects: [{ kind: 'slow', remainingDurationMs: 1000, speedMultiplier: 0.6 }],
        damage: 12,
        range: 3.5,
        fireRateTicks: shotsPerSecondToTicks(1.5),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('炮塔', 1)]: buildEntry({
        kind: '炮塔',
        level: 1,
        description: '3x3 范围爆炸伤害。',
        cost: 2,
        width: 1,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 1, splashDamageRatio: 1 },
        attackEffects: [],
        damage: 8,
        range: 2.5,
        fireRateTicks: shotsPerSecondToTicks(0.5),
        targetingStrategy: 'strongest',
    }),
    [toTowerConfigId('炮塔', 2)]: buildEntry({
        kind: '炮塔',
        level: 2,
        description: '更快的 3x3 范围爆炸伤害。',
        cost: 4,
        width: 1,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 1, splashDamageRatio: 1 },
        attackEffects: [],
        damage: 10,
        range: 2.5,
        fireRateTicks: shotsPerSecondToTicks(0.7),
        targetingStrategy: 'strongest',
    }),
    [toTowerConfigId('炮塔', 3)]: buildEntry({
        kind: '炮塔',
        level: 3,
        description: '高频 3x3 范围爆炸伤害。',
        cost: 8,
        width: 1,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 1, splashDamageRatio: 1 },
        attackEffects: [],
        damage: 12,
        range: 2.5,
        fireRateTicks: shotsPerSecondToTicks(1),
        targetingStrategy: 'strongest',
    }),
    [toTowerConfigId('激光塔', 1)]: buildEntry({
        kind: '激光塔',
        level: 1,
        description: '每 Tick 造成伤害，5 秒内最多叠加到 5% 锁定增伤。',
        cost: 3,
        width: 1,
        height: 2,
        behavior: { kind: 'beam', lockBonusPerTick: 0.001, maxLockBonus: 0.05 },
        attackEffects: [],
        damage: 1,
        range: 3.5,
        fireRateTicks: 'infinite',
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('激光塔', 2)]: buildEntry({
        kind: '激光塔',
        level: 2,
        description: '每 Tick 造成伤害，5 秒内最多叠加到 10% 锁定增伤。',
        cost: 6,
        width: 1,
        height: 2,
        behavior: { kind: 'beam', lockBonusPerTick: 0.002, maxLockBonus: 0.1 },
        attackEffects: [],
        damage: 2,
        range: 3.5,
        fireRateTicks: 'infinite',
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('激光塔', 3)]: buildEntry({
        kind: '激光塔',
        level: 3,
        description: '每 Tick 造成伤害，5 秒内最多叠加到 15% 锁定增伤。',
        cost: 10,
        width: 1,
        height: 2,
        behavior: { kind: 'beam', lockBonusPerTick: 0.003, maxLockBonus: 0.15 },
        attackEffects: [],
        damage: 3,
        range: 3.5,
        fireRateTicks: 'infinite',
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('电塔', 1)]: buildEntry({
        kind: '电塔',
        level: 1,
        description: '3x3 范围伤害并附加减防。',
        cost: 3,
        width: 1,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 1, splashDamageRatio: 1 },
        attackEffects: [{ kind: 'armor-break', remainingDurationMs: 500, defenseModifier: -0.05 }],
        damage: 5,
        range: 2.5,
        fireRateTicks: shotsPerSecondToTicks(0.5),
        targetingStrategy: 'strongest',
    }),
    [toTowerConfigId('电塔', 2)]: buildEntry({
        kind: '电塔',
        level: 2,
        description: '3x3 范围伤害并附加更强减防。',
        cost: 6,
        width: 1,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 1, splashDamageRatio: 1 },
        attackEffects: [{ kind: 'armor-break', remainingDurationMs: 700, defenseModifier: -0.1 }],
        damage: 10,
        range: 2.5,
        fireRateTicks: shotsPerSecondToTicks(0.7),
        targetingStrategy: 'strongest',
    }),
    [toTowerConfigId('电塔', 3)]: buildEntry({
        kind: '电塔',
        level: 3,
        description: '高频 3x3 范围伤害并附加减防。',
        cost: 10,
        width: 1,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 1, splashDamageRatio: 1 },
        attackEffects: [{ kind: 'armor-break', remainingDurationMs: 1000, defenseModifier: -0.15 }],
        damage: 15,
        range: 2.5,
        fireRateTicks: shotsPerSecondToTicks(1),
        targetingStrategy: 'strongest',
    }),
    [toTowerConfigId('魔法塔', 1)]: buildEntry({
        kind: '魔法塔',
        level: 1,
        description: '全图火焰打击并施加永久灼烧。',
        cost: 3,
        width: 2,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 20, splashDamageRatio: 1 },
        attackEffects: [{ kind: 'burn', remainingDurationMs: null, maxHpDamagePerSecondRatio: 0.01, ignoresDefense: true }],
        damage: 2,
        range: 20,
        fireRateTicks: shotsPerSecondToTicks(0.5),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('魔法塔', 2)]: buildEntry({
        kind: '魔法塔',
        level: 2,
        description: '更快的全图火焰打击并施加永久灼烧。',
        cost: 6,
        width: 2,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 20, splashDamageRatio: 1 },
        attackEffects: [{ kind: 'burn', remainingDurationMs: null, maxHpDamagePerSecondRatio: 0.02, ignoresDefense: true }],
        damage: 2,
        range: 20,
        fireRateTicks: shotsPerSecondToTicks(0.6),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('魔法塔', 3)]: buildEntry({
        kind: '魔法塔',
        level: 3,
        description: '高频全图火焰打击并施加永久灼烧。',
        cost: 10,
        width: 2,
        height: 2,
        behavior: { kind: 'aoe', splashRadius: 20, splashDamageRatio: 1 },
        attackEffects: [{ kind: 'burn', remainingDurationMs: null, maxHpDamagePerSecondRatio: 0.03, ignoresDefense: true }],
        damage: 2,
        range: 20,
        fireRateTicks: shotsPerSecondToTicks(0.8),
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('补给站', 1)]: buildEntry({
        kind: '补给站',
        level: 1,
        description: '为周围友军塔提供 10% 攻速提升。',
        cost: 1,
        width: 1,
        height: 1,
        behavior: { kind: 'aura', fireRateBoostRatio: 0.1 },
        attackEffects: [],
        damage: 0,
        range: 3,
        fireRateTicks: 0,
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('补给站', 2)]: buildEntry({
        kind: '补给站',
        level: 2,
        description: '为周围友军塔提供 20% 攻速提升。',
        cost: 3,
        width: 1,
        height: 1,
        behavior: { kind: 'aura', fireRateBoostRatio: 0.2 },
        attackEffects: [],
        damage: 0,
        range: 3,
        fireRateTicks: 0,
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('补给站', 3)]: buildEntry({
        kind: '补给站',
        level: 3,
        description: '为周围友军塔提供 30% 攻速提升。',
        cost: 9,
        width: 1,
        height: 1,
        behavior: { kind: 'aura', fireRateBoostRatio: 0.3 },
        attackEffects: [],
        damage: 0,
        range: 3,
        fireRateTicks: 0,
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('矿场', 1)]: buildEntry({
        kind: '矿场',
        level: 1,
        description: '每 12 秒产出 1 金币。',
        cost: 1,
        width: 2,
        height: 2,
        behavior: { kind: 'economy', intervalMs: 12000, goldPerCycle: 1 },
        attackEffects: [],
        damage: 0,
        range: 0,
        fireRateTicks: 0,
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('矿场', 2)]: buildEntry({
        kind: '矿场',
        level: 2,
        description: '每 9 秒产出 1 金币。',
        cost: 2,
        width: 2,
        height: 2,
        behavior: { kind: 'economy', intervalMs: 9000, goldPerCycle: 1 },
        attackEffects: [],
        damage: 0,
        range: 0,
        fireRateTicks: 0,
        targetingStrategy: 'nearest',
    }),
    [toTowerConfigId('矿场', 3)]: buildEntry({
        kind: '矿场',
        level: 3,
        description: '每 6 秒产出 1 金币。',
        cost: 3,
        width: 2,
        height: 2,
        behavior: { kind: 'economy', intervalMs: 6000, goldPerCycle: 1 },
        attackEffects: [],
        damage: 0,
        range: 0,
        fireRateTicks: 0,
        targetingStrategy: 'nearest',
    }),
};
exports.towerCatalog = exports.TOWER_CONFIG;
function getTowerCatalogEntryById(id) {
    return exports.towerCatalog[id] ?? null;
}
function getTowerCatalogEntry(kind, level) {
    return getTowerCatalogEntryById(toTowerConfigId(kind, level));
}
function getNextTowerCatalogEntry(kind, level) {
    if (level >= 3) {
        return null;
    }
    return getTowerCatalogEntry(kind, (level + 1));
}
function getNextTowerCatalogEntryById(id) {
    const current = getTowerCatalogEntryById(id);
    if (!current) {
        return null;
    }
    return getNextTowerCatalogEntry(current.kind, current.level);
}
function parseTowerCatalogSelection(selection) {
    if (exports.towerCatalog[selection]) {
        return exports.towerCatalog[selection];
    }
    const [kindCandidate, levelCandidate] = selection.split(':');
    if (!kindCandidate) {
        return null;
    }
    const parsedLevel = Number(levelCandidate ?? 1);
    if (![1, 2, 3].includes(parsedLevel)) {
        return null;
    }
    return getTowerCatalogEntry(kindCandidate, parsedLevel);
}
