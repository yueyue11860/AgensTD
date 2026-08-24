import { getGeneralLevelValue, resolveGeneralStats } from './catalog'
import type {
  GeneralCombatEnemy,
  GeneralCombatPlan,
  GeneralDefinition,
  GeneralFormationState,
  GeneralProgressState,
  GeneralStatModifier,
  PlannedGeneralAttack,
  ResolvedGeneralStats,
} from './types'

const distanceSquared = (
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
): number => {
  const deltaX = rightX - leftX
  const deltaY = rightY - leftY
  return deltaX * deltaX + deltaY * deltaY
}

const compareFurthestProgress = (left: GeneralCombatEnemy, right: GeneralCombatEnemy): number => {
  return right.pathProgressMilli - left.pathProgressMilli
    || left.spawnSequence - right.spawnSequence
    || left.id.localeCompare(right.id)
}

const compareHighestCurrentHp = (left: GeneralCombatEnemy, right: GeneralCombatEnemy): number => {
  return right.currentHp - left.currentHp
    || compareFurthestProgress(left, right)
}

export function initializeGeneralCombatTimers(
  definition: GeneralDefinition,
  progress: GeneralProgressState,
  currentTick: number,
  tickRateMs: number,
): GeneralProgressState {
  const stats = resolveGeneralStats(definition, progress.level)
  return {
    ...progress,
    nextBasicAttackTick: progress.nextBasicAttackTick > 0
      ? progress.nextBasicAttackTick
      : currentTick + Math.ceil(stats.attackIntervalMs / tickRateMs),
    activeSkillReadyAtTick: progress.activeSkillReadyAtTick > 0
      ? progress.activeSkillReadyAtTick
      : currentTick
        + Math.ceil(getGeneralLevelValue(definition.activeSkill.cooldownMsByLevel, progress.level) / tickRateMs),
  }
}

export function selectGeneralTarget(
  formation: GeneralFormationState,
  enemies: readonly GeneralCombatEnemy[],
  stats: ResolvedGeneralStats,
  priority: 'furthest_progress' | 'highest_current_hp',
): GeneralCombatEnemy | null {
  const rangeSquared = stats.attackRangeMilliCells * stats.attackRangeMilliCells
  const candidates = enemies.filter((enemy) => enemy.targetable
    && enemy.currentHp > 0
    && distanceSquared(
      formation.anchorMilli.x,
      formation.anchorMilli.y,
      enemy.xMilli,
      enemy.yMilli,
    ) <= rangeSquared)
  candidates.sort(priority === 'furthest_progress' ? compareFurthestProgress : compareHighestCurrentHp)
  return candidates[0] ?? null
}

export function planGeneralCombatFrame(input: {
  definition: GeneralDefinition
  formation: GeneralFormationState
  progress: GeneralProgressState
  currentTick: number
  tickRateMs: number
  enemies: readonly GeneralCombatEnemy[]
  modifiers?: readonly GeneralStatModifier[]
}): GeneralCombatPlan {
  const {
    definition,
    formation,
    currentTick,
    tickRateMs,
    enemies,
    modifiers = [],
  } = input
  if (definition.generalId !== formation.generalId
    || definition.generalId !== input.progress.generalId
    || formation.ownerPlayerId !== input.progress.ownerPlayerId) {
    throw new Error('General combat identity mismatch')
  }
  if (!Number.isSafeInteger(currentTick) || currentTick < 0 || tickRateMs <= 0) {
    throw new Error('Invalid general combat time')
  }

  let nextProgress = initializeGeneralCombatTimers(definition, input.progress, currentTick, tickRateMs)
  if (input.progress.nextBasicAttackTick === 0 && input.progress.activeSkillReadyAtTick === 0) {
    return { actions: [], nextProgress }
  }

  const rangeStats = resolveGeneralStats(definition, nextProgress.level, modifiers)
  const actions: PlannedGeneralAttack[] = []
  if (currentTick >= nextProgress.activeSkillReadyAtTick) {
    const target = selectGeneralTarget(
      formation,
      enemies,
      rangeStats,
      definition.activeSkill.targeting.priority,
    )
    if (target) {
      const targetStats = resolveGeneralStats(definition, nextProgress.level, modifiers, target.tags)
      for (const effect of definition.activeSkill.effects) {
        actions.push({
          sourceGeneralId: definition.generalId,
          sourceProgressId: nextProgress.progressId,
          sourceFormationId: formation.formationId,
          ownerPlayerId: formation.ownerPlayerId,
          actionKind: 'active_skill',
          actionId: `${definition.activeSkill.skillId}:${currentTick}`,
          targetEnemyId: target.id,
          damage: {
            effectId: effect.effectId,
            damageType: effect.damageType,
            baseAttack: targetStats.attack,
            coefficientBps: getGeneralLevelValue(effect.coefficientBpsByLevel, nextProgress.level),
            flatDamage: getGeneralLevelValue(effect.flatDamageByLevel, nextProgress.level),
            criticalPolicy: effect.criticalPolicy,
            damageDealtRatioBps: targetStats.damageDealtRatioBps,
          },
        })
      }
      nextProgress = {
        ...nextProgress,
        activeSkillReadyAtTick: currentTick + Math.ceil(
          getGeneralLevelValue(definition.activeSkill.cooldownMsByLevel, nextProgress.level) / tickRateMs,
        ),
      }
    }
  }

  if (currentTick >= nextProgress.nextBasicAttackTick) {
    const target = selectGeneralTarget(
      formation,
      enemies,
      rangeStats,
      definition.basicAttack.targeting.priority,
    )
    if (target) {
      const targetStats = resolveGeneralStats(definition, nextProgress.level, modifiers, target.tags)
      const effect = definition.basicAttack.effect
      actions.push({
        sourceGeneralId: definition.generalId,
        sourceProgressId: nextProgress.progressId,
        sourceFormationId: formation.formationId,
        ownerPlayerId: formation.ownerPlayerId,
        actionKind: 'basic_attack',
        actionId: `${definition.basicAttack.attackId}:${currentTick}`,
        targetEnemyId: target.id,
        damage: {
          effectId: effect.effectId,
          damageType: effect.damageType,
          baseAttack: targetStats.attack,
          coefficientBps: getGeneralLevelValue(effect.coefficientBpsByLevel, nextProgress.level),
          flatDamage: getGeneralLevelValue(effect.flatDamageByLevel, nextProgress.level),
          criticalPolicy: effect.criticalPolicy,
          damageDealtRatioBps: targetStats.damageDealtRatioBps,
        },
      })
      nextProgress = {
        ...nextProgress,
        nextBasicAttackTick: currentTick + Math.ceil(targetStats.attackIntervalMs / tickRateMs),
      }
    }
  }

  return { actions, nextProgress }
}
