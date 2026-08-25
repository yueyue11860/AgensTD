import type { PvpGridPosition, PvpRulesSnapshot, PvpSide, PvpSoldierDefinition, PvpSoldierType } from '../../../shared/contracts/pvp'
import { mirrorPvpPosition } from './map'

/**
 * PVP v1 竞技借用库是独立、版本化并在对局创建时冻结的。
 * 它不导入 PVE 英雄、武器、账号成长或热更平衡表。
 */
const SOLDIERS: Record<PvpSoldierType, PvpSoldierDefinition> = {
  blade: { soldierType: 'blade', glyph: '刀', name: '刀卫', attackStyle: 'single', damage: 12, rangeMilli: 2_200, attackIntervalMs: 700, armorPierce: 0 },
  spear: { soldierType: 'spear', glyph: '枪', name: '枪卫', attackStyle: 'pierce', damage: 9, rangeMilli: 3_200, attackIntervalMs: 950, armorPierce: 2 },
  bow: { soldierType: 'bow', glyph: '弓', name: '弓卫', attackStyle: 'ranged', damage: 8, rangeMilli: 5_200, attackIntervalMs: 850, armorPierce: 0 },
  cavalry: { soldierType: 'cavalry', glyph: '骑', name: '骑卫', attackStyle: 'splash', damage: 10, rangeMilli: 2_800, attackIntervalMs: 1_150, armorPierce: 1 },
}

const A_DEPLOYMENT_SLOTS: PvpGridPosition[] = [
  { x: 5, y: 2 }, { x: 8, y: 2 }, { x: 11, y: 2 }, { x: 17, y: 2 },
  { x: 20, y: 2 }, { x: 23, y: 2 }, { x: 2, y: 7 }, { x: 26, y: 7 },
  { x: 2, y: 9 }, { x: 26, y: 9 },
]

export const PVP_V1_RULES_SNAPSHOT: PvpRulesSnapshot = Object.freeze({
  snapshotVersion: 'pvp_rules_snapshot_v1',
  catalogVersion: 'pvp_loaner_four_v1',
  recruitCost: 3,
  initialRations: 10,
  roundRations: 5,
  populationCap: 10,
  pressureCost: 5,
  maxMergeLevel: 3,
  deploymentSlots: {
    A: A_DEPLOYMENT_SLOTS,
    B: A_DEPLOYMENT_SLOTS.map(mirrorPvpPosition),
  },
  soldiers: SOLDIERS,
})

export function pvpSoldier(type: PvpSoldierType): PvpSoldierDefinition {
  return SOLDIERS[type]
}

export const PVP_SOLDIER_TYPES = Object.freeze(Object.keys(SOLDIERS) as PvpSoldierType[])
