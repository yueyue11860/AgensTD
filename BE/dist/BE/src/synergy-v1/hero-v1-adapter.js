"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectHeroV1GeneralStatModifiers = projectHeroV1GeneralStatModifiers;
exports.toHeroV1GeneralStatModifiers = toHeroV1GeneralStatModifiers;
const HERO_V1_STATS = new Set([
    'attack',
    'attackSpeed',
    'attackRange',
    'critRate',
    'critDamage',
    'damageDealt',
]);
function isHeroV1Stat(stat) {
    return HERO_V1_STATS.has(stat);
}
/**
 * 将统一羁绊效果投影到 hero-v1 的有限 GeneralStatModifier 模型。
 * 该方法永不因合法的新类型羁绊效果抛错，所有未投影项都会带原因返回。
 */
function projectHeroV1GeneralStatModifiers(input) {
    const result = [];
    const unprojected = [];
    for (const effect of input.effects) {
        if (effect.type !== 'stat_modifier') {
            unprojected.push({ effect, reason: 'effect_type_not_supported' });
            continue;
        }
        if (effect.target.scope !== 'synergy_members') {
            unprojected.push({ effect, reason: 'target_scope_not_supported' });
            continue;
        }
        if (!isHeroV1Stat(effect.stat)) {
            unprojected.push({ effect, reason: 'stat_not_supported' });
            continue;
        }
        if (effect.operation !== 'add_flat' && effect.operation !== 'add_ratio') {
            unprojected.push({ effect, reason: 'operation_not_supported' });
            continue;
        }
        if ((effect.condition?.effectTagsAny?.length ?? 0) > 0) {
            unprojected.push({ effect, reason: 'effect_tag_condition_not_supported' });
            continue;
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
            ...(effect.condition?.targetTagsAny
                ? { condition: { targetTagsAny: [...effect.condition.targetTagsAny] } }
                : {}),
        });
    }
    return { modifiers: result, unprojected };
}
/**
 * 旧调用点兼容函数：仅返回 hero-v1 能表达的子集。
 * 新调用点应使用 projectHeroV1GeneralStatModifiers 查看 unprojected，
 * 或使用 runtime-projection 完整结算。
 */
function toHeroV1GeneralStatModifiers(input) {
    return projectHeroV1GeneralStatModifiers(input).modifiers;
}
