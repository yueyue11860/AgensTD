import type { SoldierLevel, SoldierType } from './types'

type LevelTuple = readonly [number, number, number, number, number]

export interface SoldierCatalogEntry {
  soldierType: SoldierType
  glyph: '刀' | '枪' | '弓' | '骑'
  displayName: string
  damageType: 'physical'
  attackShape: 'single' | 'line_pierce' | 'radius'
  attackByLevel: LevelTuple
  attackIntervalMsByLevel: LevelTuple
  attackRangeMilliCellsByLevel: LevelTuple
  critChanceBpsByLevel: LevelTuple
  critDamageBpsByLevel: LevelTuple
  maxTargetsByLevel: LevelTuple
  secondaryDamageBpsByLevel: LevelTuple
  radiusMilliCellsByLevel: LevelTuple
}

export interface WaveMinionCatalogEntry {
  waveNumber: number
  glyphPool: readonly string[]
  countPerPlayer: number
  maxHp: number
  armor: number
  magicResistance: number
  moveSpeedMilliCellsPerSecond: 1000
  spawnIntervalMs: number
  riceReward: 1
  xpRewardPoints: 1000
}

export const SOLDIER_TYPES: readonly SoldierType[] = ['blade', 'spear', 'bow', 'cavalry']

const CRIT_DAMAGE: LevelTuple = [15000, 15000, 15000, 15000, 15000]
const ONE_TARGET: LevelTuple = [1, 1, 1, 1, 1]
const NO_SECONDARY: LevelTuple = [0, 0, 0, 0, 0]
const NO_RADIUS: LevelTuple = [0, 0, 0, 0, 0]

export const SOLDIER_CATALOG: Readonly<Record<SoldierType, SoldierCatalogEntry>> = {
  blade: {
    soldierType: 'blade',
    glyph: '刀',
    displayName: '天刀兵',
    damageType: 'physical',
    attackShape: 'single',
    attackByLevel: [14, 23, 38, 61, 100],
    attackIntervalMsByLevel: [1000, 950, 900, 850, 800],
    attackRangeMilliCellsByLevel: [2250, 2400, 2550, 2700, 3000],
    critChanceBpsByLevel: [500, 600, 700, 800, 1000],
    critDamageBpsByLevel: CRIT_DAMAGE,
    maxTargetsByLevel: ONE_TARGET,
    secondaryDamageBpsByLevel: NO_SECONDARY,
    radiusMilliCellsByLevel: NO_RADIUS,
  },
  spear: {
    soldierType: 'spear',
    glyph: '枪',
    displayName: '天枪兵',
    damageType: 'physical',
    attackShape: 'line_pierce',
    attackByLevel: [13, 22, 36, 60, 99],
    attackIntervalMsByLevel: [1100, 1050, 1000, 950, 900],
    attackRangeMilliCellsByLevel: [3000, 3150, 3300, 3450, 3750],
    critChanceBpsByLevel: [400, 500, 600, 700, 800],
    critDamageBpsByLevel: CRIT_DAMAGE,
    maxTargetsByLevel: [2, 2, 3, 3, 4],
    secondaryDamageBpsByLevel: [6000, 6000, 6000, 6000, 6000],
    radiusMilliCellsByLevel: NO_RADIUS,
  },
  bow: {
    soldierType: 'bow',
    glyph: '弓',
    displayName: '天弓兵',
    damageType: 'physical',
    attackShape: 'single',
    attackByLevel: [14, 24, 40, 67, 112],
    attackIntervalMsByLevel: [1300, 1250, 1200, 1150, 1100],
    attackRangeMilliCellsByLevel: [5000, 5250, 5500, 5750, 6000],
    critChanceBpsByLevel: [800, 1000, 1200, 1400, 1600],
    critDamageBpsByLevel: CRIT_DAMAGE,
    maxTargetsByLevel: ONE_TARGET,
    secondaryDamageBpsByLevel: NO_SECONDARY,
    radiusMilliCellsByLevel: NO_RADIUS,
  },
  cavalry: {
    soldierType: 'cavalry',
    glyph: '骑',
    displayName: '天骑兵',
    damageType: 'physical',
    attackShape: 'radius',
    attackByLevel: [20, 32, 53, 89, 150],
    attackIntervalMsByLevel: [1500, 1450, 1400, 1350, 1300],
    attackRangeMilliCellsByLevel: [2750, 2900, 3050, 3200, 3500],
    critChanceBpsByLevel: [400, 500, 600, 700, 800],
    critDamageBpsByLevel: CRIT_DAMAGE,
    maxTargetsByLevel: [2, 2, 3, 3, 4],
    secondaryDamageBpsByLevel: [5500, 5500, 5500, 5500, 5500],
    radiusMilliCellsByLevel: [1000, 1000, 1250, 1250, 1500],
  },
}

const wave = (
  waveNumber: number,
  glyphPool: readonly string[],
  countPerPlayer: number,
  maxHp: number,
  armor: number,
  magicResistance: number,
  spawnIntervalMs: number,
): WaveMinionCatalogEntry => ({
  waveNumber,
  glyphPool,
  countPerPlayer,
  maxHp,
  armor,
  magicResistance,
  moveSpeedMilliCellsPerSecond: 1000,
  spawnIntervalMs,
  riceReward: 1,
  xpRewardPoints: 1000,
})

export const WAVE_MINION_CATALOG: readonly WaveMinionCatalogEntry[] = [
  wave(1, ['鬼'], 4, 28, 0, 0, 2500),
  wave(2, ['鬼', '怪'], 8, 28, 0, 0, 2000),
  wave(3, ['怪', '妖'], 9, 40, 2, 2, 1800),
  wave(4, ['妖', '魅'], 10, 55, 4, 3, 1700),
  wave(5, ['妖', '魔'], 14, 75, 6, 5, 1500),
  wave(6, ['魅', '妖'], 16, 90, 8, 7, 1400),
  wave(7, ['妖', '怪'], 18, 120, 10, 9, 1300),
  wave(8, ['魔', '魅'], 20, 160, 13, 12, 1200),
  wave(9, ['魔', '妖'], 22, 220, 16, 15, 1100),
  wave(10, ['魔', '怪'], 24, 320, 20, 18, 1000),
  wave(11, ['魔', '魅'], 30, 3500, 25, 22, 500),
  wave(12, ['魔', '妖'], 32, 4100, 28, 25, 500),
  wave(13, ['鬼', '魅'], 34, 4800, 31, 28, 500),
  wave(14, ['妖', '魔'], 36, 5600, 34, 31, 500),
  wave(15, ['魔', '魅'], 38, 6500, 38, 35, 400),
  wave(16, ['魔', '妖'], 40, 7550, 42, 39, 400),
  wave(17, ['鬼', '魔'], 42, 8750, 46, 43, 400),
  wave(18, ['妖', '魅'], 44, 10150, 50, 47, 400),
  wave(19, ['魔', '鬼'], 46, 11750, 55, 52, 300),
  wave(20, ['魔', '魅'], 50, 13600, 60, 58, 300),
]

export function getSoldierCatalogEntry(type: SoldierType): SoldierCatalogEntry {
  return SOLDIER_CATALOG[type]
}

export function getSoldierLevelValue(values: LevelTuple, level: SoldierLevel): number {
  return values[level - 1]
}

export function getWaveMinionCatalogEntry(waveNumber: number): WaveMinionCatalogEntry | null {
  return WAVE_MINION_CATALOG[waveNumber - 1] ?? null
}

export function validatePveV2Catalogs(): void {
  for (const type of SOLDIER_TYPES) {
    const entry = SOLDIER_CATALOG[type]
    const arrays: readonly LevelTuple[] = [
      entry.attackByLevel,
      entry.attackIntervalMsByLevel,
      entry.attackRangeMilliCellsByLevel,
      entry.critChanceBpsByLevel,
      entry.critDamageBpsByLevel,
      entry.maxTargetsByLevel,
      entry.secondaryDamageBpsByLevel,
      entry.radiusMilliCellsByLevel,
    ]

    if (arrays.some((values) => values.length !== 5)) {
      throw new Error(`Soldier catalog ${type} must define exactly five levels`)
    }
  }

  if (WAVE_MINION_CATALOG.length !== 20) {
    throw new Error('Wave minion catalog must define exactly twenty waves')
  }

  for (let index = 0; index < WAVE_MINION_CATALOG.length; index += 1) {
    const entry = WAVE_MINION_CATALOG[index]
    if (entry.waveNumber !== index + 1 || entry.moveSpeedMilliCellsPerSecond !== 1000) {
      throw new Error(`Invalid wave catalog entry at index ${index}`)
    }
  }
}
