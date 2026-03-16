import type { EnemyKind } from './game-state'

export interface EnemyCatalogEntry {
  kind: EnemyKind
  label: string
  description: string
  maxHp: number
  speed: number
  defense: number
  rewardGold: number
  baseDamage: number
  threat: 'low' | 'medium' | 'high'
}

export const enemyCatalog: Record<EnemyKind, EnemyCatalogEntry> = {
  runner: {
    kind: 'runner',
    label: 'Runner',
    description: '标准地面单位，数值均衡，适合铺底波次。',
    maxHp: 100,
    speed: 1,
    defense: 0,
    rewardGold: 15,
    baseDamage: 1,
    threat: 'low',
  },
  swift: {
    kind: 'swift',
    label: 'Swift',
    description: '轻甲高速单位，适合压迫防线响应速度。',
    maxHp: 70,
    speed: 2,
    defense: 0,
    rewardGold: 12,
    baseDamage: 1,
    threat: 'medium',
  },
  brute: {
    kind: 'brute',
    label: 'Brute',
    description: '重装高血量单位，考验高爆发火力和优先级策略。',
    maxHp: 220,
    speed: 1,
    defense: 6,
    rewardGold: 35,
    baseDamage: 2,
    threat: 'high',
  },
}