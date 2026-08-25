import { getPassiveItemDefinition } from './catalog'
import { MatchItemLoadoutSnapshot, PassiveRuleProjection } from './types'

export function projectPassiveItemRules(
  matchId: string,
  snapshot: MatchItemLoadoutSnapshot,
): PassiveRuleProjection {
  let startingRationsBonus = 0
  let paidRecruitCostFlat = 0
  let paidRecruitMinimumCost = 0
  let ownLaneWaveClearRationsBonus = 0
  let characterProbabilityBps: number | undefined
  let characterPity: PassiveRuleProjection['characterPity']
  let reserveCapacityBonus = 0
  let populationCapBonus = 0
  const generalLevelCaps: Partial<Record<'purple' | 'orange', 5>> = {}
  let generalExperienceGainBps = 0
  let bossFragmentBonus: PassiveRuleProjection['bossFragmentBonus']
  const sourceKeys: string[] = []
  const combatEffects: PassiveRuleProjection['combatEffects'][number][] = []
  const listeners: PassiveRuleProjection['listeners'][number][] = []

  snapshot.passiveSlots.forEach((itemId, slotIndex) => {
    if (!itemId) return
    const definition = getPassiveItemDefinition(itemId)
    if (!definition) throw new Error(`Snapshot is missing passive item ${itemId}`)
    const itemSource = `passive_item:${matchId}:${snapshot.playerId}:${slotIndex}:${itemId}`
    sourceKeys.push(itemSource)
    for (const effect of definition.effects) {
      combatEffects.push({
        sourceKey: `${itemSource}:${effect.effectId}`,
        itemId,
        slotIndex,
        effect,
      })
    }
    listeners.push(...definition.eventListeners)

    for (const modifier of definition.ruleModifiers) {
      switch (modifier.type) {
        case 'starting_rations':
          startingRationsBonus += modifier.addFlat
          break
        case 'paid_recruit_cost':
          paidRecruitCostFlat += modifier.addFlat
          paidRecruitMinimumCost = Math.max(paidRecruitMinimumCost, modifier.minimumCost)
          break
        case 'own_lane_wave_clear_rations':
          ownLaneWaveClearRationsBonus += modifier.addFlat
          break
        case 'character_probability':
          characterProbabilityBps = Math.max(characterProbabilityBps ?? 0, modifier.probabilityBps)
          break
        case 'paid_recruit_character_pity':
          characterPity = modifier
          break
        case 'reserve_capacity':
          reserveCapacityBonus += modifier.addFlat
          break
        case 'population_cap':
          populationCapBonus += modifier.addFlat
          break
        case 'general_level_cap':
          generalLevelCaps[modifier.quality] = modifier.maxLevel
          break
        case 'general_experience_gain':
          generalExperienceGainBps += modifier.addRatioBps
          break
        case 'boss_fragment_bonus':
          bossFragmentBonus = modifier
          break
      }
    }
  })

  return {
    playerId: snapshot.playerId,
    sourceKeys,
    startingRationsBonus,
    paidRecruitCostFlat,
    paidRecruitMinimumCost,
    ownLaneWaveClearRationsBonus,
    characterProbabilityBps,
    characterPity,
    reserveCapacityBonus,
    populationCapBonus,
    generalLevelCaps,
    generalExperienceGainBps,
    combatEffects,
    bossFragmentBonus,
    listeners,
  }
}

export function resolvePaidRecruitCost(baseCost: number, projection: PassiveRuleProjection): number {
  return Math.max(projection.paidRecruitMinimumCost, baseCost + projection.paidRecruitCostFlat)
}

export function resolveGeneralLevelCap(
  quality: 'purple' | 'orange' | 'red',
  defaultCap: number,
  projection: PassiveRuleProjection,
): number {
  if (quality === 'red') return defaultCap
  return projection.generalLevelCaps[quality] ?? defaultCap
}

export function resolveGeneralExperience(
  weightedExperiencePoints: number,
  projection: PassiveRuleProjection,
): number {
  return Math.floor(weightedExperiencePoints * (10_000 + projection.generalExperienceGainBps) / 10_000)
}
