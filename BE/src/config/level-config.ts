import type { WaveConfig } from '../../../shared/contracts/game'
import { PVE_STAGE_DEFINITIONS } from '../../../shared/contracts/pve-stage-config'
import type { PlayerKind } from '../domain/game-state'

/**
 * 新版 PVE 关卡只表达场景，不再表达旧版“难度阶梯”。
 * 所有关卡统一使用 20 波；实际普通怪数值由 pve-v2/catalogs.ts 驱动，
 * 第 5/10/15/20 波 Boss 已由 pve-v2/boss-catalog.ts 与 boss-runtime.ts 接入。
 */
export interface LevelConfig {
  levelId: number
  stageId: string
  label: string
  description: string
  /** 兼容旧客户端字段；新版关卡不再按预估通关率区分难度。 */
  targetClearRate: number
  allowedPlayerKinds: PlayerKind[]
  startingGold?: number
  minPlayers: number
  capacityPerPlayer: 10
  waves: WaveConfig[]
}

const PVE_WAVE_COUNT = 20

function createUnifiedTwentyWavePlan(): WaveConfig[] {
  return Array.from({ length: PVE_WAVE_COUNT }, (_, index) => ({
    waveNumber: index + 1,
    prepTime: 50,
    // 新版运行时从 WAVE_MINION_CATALOG 读取生成配置；这里保留结构用于房间协议和旧客户端展示。
    groups: [],
  }))
}

function createLevel(
  levelId: number,
  stageId: string,
  label: string,
  description: string,
): LevelConfig {
  return {
    levelId,
    stageId,
    label,
    description,
    targetClearRate: 0,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: createUnifiedTwentyWavePlan(),
  }
}

export const LEVEL_CONFIGS: Readonly<Record<number, LevelConfig>> = Object.freeze(Object.fromEntries(
  PVE_STAGE_DEFINITIONS.map((definition) => [
    definition.levelId,
    createLevel(
      definition.levelId,
      definition.stageId,
      definition.label,
      `${definition.description}共 20 波，每波每路固定 10 只小怪；关卡字池：${definition.minionGlyphs.join('、')}。`,
    ),
  ]),
))

export const ORDERED_STANDARD_LEVEL_IDS: readonly number[] = PVE_STAGE_DEFINITIONS.map(({ levelId }) => levelId)

export const ALL_LEVEL_IDS: readonly number[] = ORDERED_STANDARD_LEVEL_IDS

export function getWavesForLevel(levelId: number): WaveConfig[] | null {
  return LEVEL_CONFIGS[levelId]?.waves ?? null
}
