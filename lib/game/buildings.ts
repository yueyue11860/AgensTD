import type { CoreTargetMode, CoreTowerType } from '../domain.ts'

export interface BuildingLevelStats {
  level: 1 | 2 | 3
  attack: number
  cost: number
  attackRate: number
  footprint: {
    width: number
    height: number
  }
  range: number
  role: string
  effectText: string
  slowFactor?: number
  slowDuration?: number
  armorShred?: number
  armorShredDuration?: number
  burnRatio?: number
  auraAttackSpeed?: number
  incomeInterval?: number
  laserRampBonus?: number
}

export interface BuildingDefinition {
  type: CoreTowerType
  name: string
  actionLabel: string
  defaultTargetMode: CoreTargetMode
  category: 'attack' | 'support' | 'economy'
  attackKind: 'single' | 'splash' | 'global' | 'aura' | 'economy'
  levels: [BuildingLevelStats, BuildingLevelStats, BuildingLevelStats]
}

export const BUILDING_ORDER: CoreTowerType[] = ['ARROW', 'ICE', 'CANNON', 'LASER', 'TESLA', 'MAGIC', 'SUPPLY', 'MINE']

export const BUILDING_DEFINITIONS: Record<CoreTowerType, BuildingDefinition> = {
  ARROW: {
    type: 'ARROW',
    name: '箭塔',
    actionLabel: '箭塔',
    defaultTargetMode: '前锋',
    category: 'attack',
    attackKind: 'single',
    levels: [
      { level: 1, attack: 10, cost: 1, attackRate: 1, footprint: { width: 1, height: 1 }, range: 1, role: '单体压制', effectText: '稳定单体输出。' },
      { level: 2, attack: 15, cost: 2, attackRate: 1.2, footprint: { width: 1, height: 1 }, range: 1, role: '单体压制', effectText: '提升对前排单位的秒伤。' },
      { level: 3, attack: 20, cost: 4, attackRate: 1.5, footprint: { width: 1, height: 1 }, range: 1, role: '单体压制', effectText: '适合补最后一道斩杀线。' },
    ],
  },
  ICE: {
    type: 'ICE',
    name: '冰塔',
    actionLabel: '冰塔',
    defaultTargetMode: '前锋',
    category: 'attack',
    attackKind: 'single',
    levels: [
      { level: 1, attack: 8, cost: 2, attackRate: 1, footprint: { width: 1, height: 1 }, range: 1, role: '减速控场', effectText: '减速 20%，持续 0.5 秒。', slowFactor: 0.2, slowDuration: 0.5 },
      { level: 2, attack: 10, cost: 4, attackRate: 1.2, footprint: { width: 1, height: 1 }, range: 1, role: '减速控场', effectText: '减速 30%，持续 0.7 秒。', slowFactor: 0.3, slowDuration: 0.7 },
      { level: 3, attack: 12, cost: 8, attackRate: 1.5, footprint: { width: 1, height: 1 }, range: 1, role: '减速控场', effectText: '减速 40%，持续 1 秒。', slowFactor: 0.4, slowDuration: 1 },
    ],
  },
  CANNON: {
    type: 'CANNON',
    name: '炮塔',
    actionLabel: '炮塔',
    defaultTargetMode: '高生命',
    category: 'attack',
    attackKind: 'splash',
    levels: [
      { level: 1, attack: 8, cost: 2, attackRate: 0.5, footprint: { width: 1, height: 2 }, range: 3, role: '范围爆发', effectText: '3x3 范围攻击。' },
      { level: 2, attack: 10, cost: 4, attackRate: 0.7, footprint: { width: 1, height: 2 }, range: 3, role: '范围爆发', effectText: '3x3 范围攻击。' },
      { level: 3, attack: 12, cost: 8, attackRate: 1, footprint: { width: 1, height: 2 }, range: 3, role: '范围爆发', effectText: '3x3 范围攻击。' },
    ],
  },
  LASER: {
    type: 'LASER',
    name: '激光塔',
    actionLabel: '激光塔',
    defaultTargetMode: '高生命',
    category: 'attack',
    attackKind: 'single',
    levels: [
      { level: 1, attack: 1, cost: 3, attackRate: 6, footprint: { width: 1, height: 2 }, range: 1, role: '持续聚焦', effectText: '持续锁定 5 秒内达到 5% 增伤，换目标重置。', laserRampBonus: 0.05 },
      { level: 2, attack: 2, cost: 6, attackRate: 6, footprint: { width: 1, height: 2 }, range: 1, role: '持续聚焦', effectText: '持续锁定 5 秒内达到 10% 增伤，换目标重置。', laserRampBonus: 0.1 },
      { level: 3, attack: 3, cost: 10, attackRate: 6, footprint: { width: 1, height: 2 }, range: 1, role: '持续聚焦', effectText: '持续锁定 5 秒内达到 15% 增伤，换目标重置。', laserRampBonus: 0.15 },
    ],
  },
  TESLA: {
    type: 'TESLA',
    name: '电塔',
    actionLabel: '电塔',
    defaultTargetMode: '高生命',
    category: 'attack',
    attackKind: 'splash',
    levels: [
      { level: 1, attack: 5, cost: 3, attackRate: 0.5, footprint: { width: 1, height: 2 }, range: 3, role: '减防压血', effectText: '3x3 范围攻击并减防 5%。', armorShred: 0.05, armorShredDuration: 0.5 },
      { level: 2, attack: 10, cost: 6, attackRate: 0.7, footprint: { width: 1, height: 2 }, range: 3, role: '减防压血', effectText: '3x3 范围攻击并减防 10%。', armorShred: 0.1, armorShredDuration: 0.7 },
      { level: 3, attack: 15, cost: 10, attackRate: 1, footprint: { width: 1, height: 2 }, range: 3, role: '减防压血', effectText: '3x3 范围攻击并减防 15%。', armorShred: 0.15, armorShredDuration: 1 },
    ],
  },
  MAGIC: {
    type: 'MAGIC',
    name: '魔法塔',
    actionLabel: '魔法塔',
    defaultTargetMode: '高生命',
    category: 'attack',
    attackKind: 'global',
    levels: [
      { level: 1, attack: 2, cost: 3, attackRate: 0.5, footprint: { width: 2, height: 2 }, range: 20, role: '全屏灼烧', effectText: '全屏降火，永久灼烧 1% 最大生命值 / 秒。', burnRatio: 0.01 },
      { level: 2, attack: 2, cost: 6, attackRate: 0.6, footprint: { width: 2, height: 2 }, range: 20, role: '全屏灼烧', effectText: '全屏降火，永久灼烧 2% 最大生命值 / 秒。', burnRatio: 0.02 },
      { level: 3, attack: 2, cost: 10, attackRate: 0.8, footprint: { width: 2, height: 2 }, range: 20, role: '全屏灼烧', effectText: '全屏降火，永久灼烧 3% 最大生命值 / 秒。', burnRatio: 0.03 },
    ],
  },
  SUPPLY: {
    type: 'SUPPLY',
    name: '补给站',
    actionLabel: '补给站',
    defaultTargetMode: '前锋',
    category: 'support',
    attackKind: 'aura',
    levels: [
      { level: 1, attack: 0, cost: 1, attackRate: 0, footprint: { width: 1, height: 1 }, range: 6, role: '攻速光环', effectText: '6x6 范围友军攻速 +10%。', auraAttackSpeed: 0.1 },
      { level: 2, attack: 0, cost: 3, attackRate: 0, footprint: { width: 1, height: 1 }, range: 6, role: '攻速光环', effectText: '6x6 范围友军攻速 +20%。', auraAttackSpeed: 0.2 },
      { level: 3, attack: 0, cost: 9, attackRate: 0, footprint: { width: 1, height: 1 }, range: 6, role: '攻速光环', effectText: '6x6 范围友军攻速 +30%。', auraAttackSpeed: 0.3 },
    ],
  },
  MINE: {
    type: 'MINE',
    name: '矿场',
    actionLabel: '矿场',
    defaultTargetMode: '前锋',
    category: 'economy',
    attackKind: 'economy',
    levels: [
      { level: 1, attack: 0, cost: 1, attackRate: 0, footprint: { width: 2, height: 2 }, range: 0, role: '经济产出', effectText: '每 12 秒产出 1 金币。', incomeInterval: 12 },
      { level: 2, attack: 0, cost: 2, attackRate: 0, footprint: { width: 2, height: 2 }, range: 0, role: '经济产出', effectText: '每 9 秒产出 1 金币。', incomeInterval: 9 },
      { level: 3, attack: 0, cost: 3, attackRate: 0, footprint: { width: 2, height: 2 }, range: 0, role: '经济产出', effectText: '每 6 秒产出 1 金币。', incomeInterval: 6 },
    ],
  },
}

export function getBuildingDefinition(type: CoreTowerType) {
  return BUILDING_DEFINITIONS[type]
}

export function getBuildingLevel(type: CoreTowerType, tier: number) {
  const definition = getBuildingDefinition(type)
  return definition.levels[Math.max(0, Math.min(definition.levels.length - 1, tier - 1))]
}

export function getBuildingLabel(type: CoreTowerType) {
  return getBuildingDefinition(type).name
}