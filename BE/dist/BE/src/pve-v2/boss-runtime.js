"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BossCombatRuntimeV1 = exports.BOSS_RUNTIME_SCHEMA_VERSION = void 0;
exports.settleBossControlDurationMs = settleBossControlDurationMs;
exports.settleEnemySlowBps = settleEnemySlowBps;
exports.nextLaneSpawnEntityKind = nextLaneSpawnEntityKind;
exports.isLaneWaveSpawningComplete = isLaneWaveSpawningComplete;
exports.BOSS_RUNTIME_SCHEMA_VERSION = 1;
function settleBossControlDurationMs(requestedDurationMs, controlResistanceBps, maxSingleControlDurationMs) {
    const resisted = Math.floor(Math.max(0, requestedDurationMs)
        * (10000 - Math.min(10000, Math.max(0, controlResistanceBps))) / 10000);
    return maxSingleControlDurationMs > 0 ? Math.min(maxSingleControlDurationMs, resisted) : resisted;
}
function settleEnemySlowBps(entityKind, requestedSlowBps) {
    return Math.min(entityKind === 'boss' ? 4000 : 8000, Math.max(0, Math.floor(requestedSlowBps)));
}
function nextLaneSpawnEntityKind(input) {
    if (input.ordinarySpawnedCount < input.ordinaryTotalCount)
        return 'ordinary_minion';
    if (input.bossRequired && !input.bossSpawned)
        return 'boss';
    return null;
}
function isLaneWaveSpawningComplete(input) {
    return input.ordinarySpawnedCount >= input.ordinaryTotalCount
        && (!input.bossRequired || input.bossSpawned || input.retired === true);
}
function integerParameter(binding, key, fallback, min, max) {
    const raw = binding.parameters[key];
    if (!Number.isFinite(raw))
        return fallback;
    return Math.min(max, Math.max(min, Math.floor(raw)));
}
function ticks(ms, tickRateMs) {
    return Math.max(1, Math.ceil(ms / tickRateMs));
}
function intensityValue(context, value, max) {
    return Math.min(max, Math.max(0, Math.floor(value * context.instance.skillIntensityBps / 10000)));
}
function warning(context, telegraphMs) {
    const executeAtTick = context.tick + ticks(telegraphMs, context.tickRateMs);
    context.state.lifecycle = 'warning';
    context.state.nextTransitionTick = executeAtTick;
    context.instance.activeCast = {
        skillId: context.state.binding.bindingId,
        skillName: context.state.binding.displayName ?? context.state.binding.bindingId,
        startedAtTick: context.tick,
        executeAtTick,
        targetPlayerIds: [context.instance.laneOwnerPlayerId],
    };
    context.emit('BOSS_CAST_WARNING', {
        bossEnemyId: context.boss.id,
        bossDefinitionId: context.instance.bossDefinitionId,
        bossName: context.instance.bossName,
        skillId: context.state.binding.bindingId,
        skillName: context.state.binding.displayName ?? context.state.binding.bindingId,
        pluginId: context.state.binding.pluginId,
        executeAtTick,
        targetPlayerIds: [context.instance.laneOwnerPlayerId],
    });
}
function activate(context, durationMs) {
    context.state.lifecycle = 'active';
    context.state.castCount += 1;
    context.state.nextTransitionTick = context.tick + ticks(durationMs, context.tickRateMs);
    context.instance.activeCast = null;
    context.emit('BOSS_SKILL_CAST', {
        bossEnemyId: context.boss.id,
        bossDefinitionId: context.instance.bossDefinitionId,
        bossName: context.instance.bossName,
        skillId: context.state.binding.bindingId,
        skillName: context.state.binding.displayName ?? context.state.binding.bindingId,
        pluginId: context.state.binding.pluginId,
        activeUntilTick: context.state.nextTransitionTick,
        targetPlayerIds: [context.instance.laneOwnerPlayerId],
    });
}
function endActive(context, lifecycle, nextTransitionTick) {
    context.emit('BOSS_SKILL_ENDED', {
        bossEnemyId: context.boss.id,
        bossDefinitionId: context.instance.bossDefinitionId,
        bossName: context.instance.bossName,
        skillId: context.state.binding.bindingId,
        skillName: context.state.binding.displayName ?? context.state.binding.bindingId,
        pluginId: context.state.binding.pluginId,
    });
    context.state.lifecycle = lifecycle;
    context.state.nextTransitionTick = nextTransitionTick;
}
const laneMinionHastePlugin = {
    pluginId: 'lane_minion_haste_v1',
    pluginVersion: 1,
    initialize(context) {
        const delayMs = integerParameter(context.state.binding, 'initialDelayMs', 1000, 0, 60000);
        context.state.nextTransitionTick = context.tick + ticks(delayMs, context.tickRateMs);
    },
    tick(context) {
        const binding = context.state.binding;
        const maxCasts = integerParameter(binding, 'maxCasts', 99, 1, 999);
        if ((context.state.lifecycle === 'ready' || context.state.lifecycle === 'cooldown')
            && context.tick >= context.state.nextTransitionTick && context.state.castCount < maxCasts) {
            warning(context, integerParameter(binding, 'telegraphMs', 1500, 100, 30000));
        }
        else if (context.state.lifecycle === 'warning' && context.tick >= context.state.nextTransitionTick) {
            activate(context, integerParameter(binding, 'durationMs', 5000, 100, 60000));
        }
        else if (context.state.lifecycle === 'active' && context.tick >= context.state.nextTransitionTick) {
            const cooldown = ticks(integerParameter(binding, 'cooldownMs', 10000, 100, 120000), context.tickRateMs);
            endActive(context, context.state.castCount >= maxCasts ? 'disabled' : 'cooldown', context.tick + cooldown);
        }
    },
    cleanup(context) {
        if (context.state.lifecycle === 'active' || context.state.lifecycle === 'warning') {
            endActive(context, 'disabled', context.tick);
        }
        else
            context.state.lifecycle = 'disabled';
        context.instance.activeCast = null;
    },
    movementBonusBps(context, enemy) {
        if (context.state.lifecycle !== 'active' || enemy.entityKind !== 'ordinary_minion')
            return 0;
        if (enemy.laneOwnerPlayerId !== context.instance.laneOwnerPlayerId || enemy.laneSlot !== context.instance.laneSlot)
            return 0;
        return intensityValue(context, integerParameter(context.state.binding, 'speedBonusBps', 3000, 0, 20000), 20000);
    },
};
const phaseGuardPlugin = {
    pluginId: 'phase_guard_v1',
    pluginVersion: 1,
    initialize(context) {
        context.state.nextTransitionTick = context.tick;
    },
    tick(context) {
        const binding = context.state.binding;
        const threshold = integerParameter(binding, 'hpThresholdBps', 5000, 1, 9999);
        const hpRatioBps = Math.floor(context.boss.currentHp * 10000 / Math.max(1, context.boss.maxHp));
        if (context.state.lifecycle === 'ready' && hpRatioBps <= threshold) {
            warning(context, integerParameter(binding, 'telegraphMs', 1000, 100, 30000));
        }
        else if (context.state.lifecycle === 'warning' && context.tick >= context.state.nextTransitionTick) {
            activate(context, integerParameter(binding, 'durationMs', 6000, 100, 60000));
            context.instance.phase += 1;
            context.emit('BOSS_PHASE_CHANGED', {
                bossEnemyId: context.boss.id,
                bossDefinitionId: context.instance.bossDefinitionId,
                bossName: context.instance.bossName,
                phase: context.instance.phase,
            });
        }
        else if (context.state.lifecycle === 'active' && context.tick >= context.state.nextTransitionTick) {
            endActive(context, 'disabled', context.tick);
        }
    },
    cleanup(context) {
        if (context.state.lifecycle === 'active' || context.state.lifecycle === 'warning') {
            endActive(context, 'disabled', context.tick);
        }
        else
            context.state.lifecycle = 'disabled';
        context.instance.activeCast = null;
    },
    movementBonusBps(context, enemy) {
        if (context.state.lifecycle !== 'active' || enemy.id !== context.boss.id)
            return 0;
        return intensityValue(context, integerParameter(context.state.binding, 'moveSpeedBonusBps', 2000, 0, 20000), 20000);
    },
    damageTakenReductionBps(context) {
        if (context.state.lifecycle !== 'active')
            return 0;
        return intensityValue(context, integerParameter(context.state.binding, 'damageTakenReductionBps', 3000, 0, 9000), 9000);
    },
};
const PLUGINS = new Map([
    [laneMinionHastePlugin.pluginId, laneMinionHastePlugin],
    [phaseGuardPlugin.pluginId, phaseGuardPlugin],
]);
/**
 * 版本化 Boss 技能聚合。目录只声明 pluginId + 参数，运行时注册表负责生命周期；
 * 未知/异常插件只禁用自身，不中断 Tick，也不会污染其他路线。
 */
class BossCombatRuntimeV1 {
    tickRateMs;
    schemaVersion = exports.BOSS_RUNTIME_SCHEMA_VERSION;
    instances = new Map();
    constructor(tickRateMs) {
        this.tickRateMs = tickRateMs;
    }
    registerBoss(enemy, encounter, tick, emit) {
        if (enemy.entityKind !== 'boss' || this.instances.has(enemy.id))
            return;
        const instance = {
            bossEnemyId: enemy.id,
            bossDefinitionId: encounter.definition.bossDefinitionId,
            bossName: encounter.definition.displayName,
            laneOwnerPlayerId: enemy.laneOwnerPlayerId,
            laneSlot: enemy.laneSlot,
            waveNumber: enemy.waveNumber,
            phase: 1,
            skillIntensityBps: Math.max(0, Math.floor(encounter.stats.skillIntensityBps)),
            activeCast: null,
            skills: encounter.definition.skills
                .slice().sort((a, b) => a.bindingId.localeCompare(b.bindingId))
                .map((binding) => ({ binding, lifecycle: 'ready', castCount: 0, nextTransitionTick: tick })),
        };
        this.instances.set(enemy.id, instance);
        for (const state of instance.skills)
            this.invokePlugin(instance, state, enemy, tick, emit, 'initialize');
    }
    advance(context) {
        const enemies = new Map(context.enemies.map((enemy) => [enemy.id, enemy]));
        for (const instance of [...this.instances.values()].sort((a, b) => a.bossEnemyId.localeCompare(b.bossEnemyId))) {
            const boss = enemies.get(instance.bossEnemyId);
            if (!boss || boss.lifecycle !== 'alive')
                continue;
            for (const state of instance.skills) {
                if (state.lifecycle !== 'disabled')
                    this.invokePlugin(instance, state, boss, context.tick, context.emit, 'tick');
            }
        }
    }
    handleBossDeath(enemy, tick, emit) {
        const instance = this.instances.get(enemy.id);
        if (!instance)
            return;
        for (const state of instance.skills)
            this.invokePlugin(instance, state, enemy, tick, emit, 'cleanup', 'boss_died');
        this.instances.delete(enemy.id);
    }
    movementRatioBps(enemy, enemies, tick, emit) {
        let bonus = 0;
        for (const instance of [...this.instances.values()].sort((a, b) => a.bossEnemyId.localeCompare(b.bossEnemyId))) {
            const boss = enemies.find((candidate) => candidate.id === instance.bossEnemyId && candidate.lifecycle === 'alive');
            if (!boss)
                continue;
            for (const state of instance.skills) {
                const plugin = PLUGINS.get(state.binding.pluginId);
                if (!plugin?.movementBonusBps || state.lifecycle === 'disabled')
                    continue;
                try {
                    bonus = Math.max(bonus, plugin.movementBonusBps(this.context(instance, state, boss, tick, emit), enemy));
                }
                catch (error) {
                    this.disablePlugin(instance, state, boss, tick, emit, error);
                }
            }
        }
        return Math.max(0, 10000 + bonus);
    }
    damageTakenRatioBps(enemy, enemies, tick, emit) {
        const instance = this.instances.get(enemy.id);
        if (!instance || enemy.entityKind !== 'boss')
            return 10000;
        let reduction = 0;
        for (const state of instance.skills) {
            const plugin = PLUGINS.get(state.binding.pluginId);
            if (!plugin?.damageTakenReductionBps || state.lifecycle === 'disabled')
                continue;
            try {
                reduction += plugin.damageTakenReductionBps(this.context(instance, state, enemy, tick, emit));
            }
            catch (error) {
                this.disablePlugin(instance, state, enemy, tick, emit, error);
            }
        }
        return Math.max(1000, 10000 - Math.min(9000, reduction));
    }
    projectEnemy(enemyId) {
        const instance = this.instances.get(enemyId);
        return instance ? { phase: instance.phase, activeCast: instance.activeCast ? structuredClone(instance.activeCast) : null } : null;
    }
    snapshot() {
        return {
            schemaVersion: exports.BOSS_RUNTIME_SCHEMA_VERSION,
            instances: [...this.instances.values()].sort((a, b) => a.bossEnemyId.localeCompare(b.bossEnemyId)).map((instance) => ({
                bossEnemyId: instance.bossEnemyId,
                bossDefinitionId: instance.bossDefinitionId,
                laneOwnerPlayerId: instance.laneOwnerPlayerId,
                phase: instance.phase,
                activeCast: instance.activeCast ? structuredClone(instance.activeCast) : null,
                skillStates: instance.skills.map((state) => ({
                    skillId: state.binding.bindingId,
                    lifecycle: state.lifecycle,
                    castCount: state.castCount,
                    nextTransitionTick: state.nextTransitionTick,
                })),
            })),
        };
    }
    invokePlugin(instance, state, boss, tick, emit, method, cleanupReason) {
        const plugin = PLUGINS.get(state.binding.pluginId);
        if (!plugin || plugin.pluginVersion !== state.binding.pluginVersion) {
            this.disablePlugin(instance, state, boss, tick, emit, new Error('Unsupported boss skill plugin/version'));
            return;
        }
        try {
            if (method === 'cleanup')
                plugin.cleanup(this.context(instance, state, boss, tick, emit), cleanupReason ?? 'match_finished');
            else
                plugin[method](this.context(instance, state, boss, tick, emit));
        }
        catch (error) {
            this.disablePlugin(instance, state, boss, tick, emit, error);
        }
    }
    context(instance, state, boss, tick, emit) {
        return { tick, tickRateMs: this.tickRateMs, boss, instance, state, emit };
    }
    disablePlugin(instance, state, boss, tick, emit, error) {
        state.lifecycle = 'disabled';
        state.nextTransitionTick = tick;
        if (instance.activeCast?.skillId === state.binding.bindingId)
            instance.activeCast = null;
        emit('BOSS_SKILL_PLUGIN_ERROR', {
            bossEnemyId: boss.id,
            bossDefinitionId: instance.bossDefinitionId,
            bossName: instance.bossName,
            skillId: state.binding.bindingId,
            skillName: state.binding.displayName ?? state.binding.bindingId,
            pluginId: state.binding.pluginId,
            message: error instanceof Error ? error.message : 'Unknown boss plugin error',
        });
    }
}
exports.BossCombatRuntimeV1 = BossCombatRuntimeV1;
