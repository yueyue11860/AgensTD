"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toHeroV1GeneralStatModifiers = toHeroV1GeneralStatModifiers;
const HERO_V1_STATS = new Set([
    'attack',
    'attackSpeed',
    'attackRange',
    'critRate',
    'critDamage',
]);
function isHeroV1Stat(stat) {
    return HERO_V1_STATS.has(stat);
}
/**
 * 首个纵向切片的精确边界适配器。它只接受 hero-v1 已支持的成员属性修改；
 * 技能参数补丁、分类目标和召唤物目标等待统一效果执行器，不在这里静默忽略。
 */
function toHeroV1GeneralStatModifiers(input) {
    const result = [];
    for (const effect of input.effects) {
        if (effect.type !== 'stat_modifier') {
            throw new Error(`hero-v1 cannot apply synergy effect type ${effect.type}`);
        }
        if (effect.target.scope !== 'synergy_members') {
            throw new Error(`hero-v1 cannot apply synergy target scope ${effect.target.scope}`);
        }
        if (!isHeroV1Stat(effect.stat)) {
            throw new Error(`hero-v1 does not support synergy stat ${effect.stat}`);
        }
        if (effect.operation !== 'add_flat' && effect.operation !== 'add_ratio') {
            throw new Error(`hero-v1 does not support modifier operation ${effect.operation}`);
        }
        result.push({
            source: { kind: 'synergy', sourceId: input.sourceSynergyId },
            target: {
                scope: 'synergy_members',
                generalIds: [...input.contributingGeneralIds],
            },
            stat: effect.stat,
            operation: effect.operation,
            value: effect.value,
            stackGroup: effect.stackGroup,
        });
    }
    return result;
}
