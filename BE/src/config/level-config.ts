import type { WaveConfig } from '../../../shared/contracts/game'
import type { PlayerKind } from '../domain/game-state'

/**
 * 新版 PVE 关卡只表达场景，不再表达旧版“难度阶梯”。
 * 所有关卡统一使用 20 波；实际普通怪数值由 pve-v2/catalogs.ts 驱动，
 * 第 5/10/15/20 波 Boss 将由 Boss 专项逐步接入。
 */
export interface LevelConfig {
  levelId: number
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
  label: string,
  description: string,
): LevelConfig {
  return {
    levelId,
    label,
    description,
    targetClearRate: 0,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: createUnifiedTwentyWavePlan(),
  }
}

export const LEVEL_CONFIGS: Readonly<Record<number, LevelConfig>> = {
  1: createLevel(1, '花果山', '花果山场景关卡，共 20 波。第 5、10、15、20 波为 Boss 节点。'),
  2: createLevel(2, '流沙河', '流沙河场景关卡，共 20 波。场景字池与 Boss 将由关卡专项接入。'),
  3: createLevel(3, '盘丝洞', '盘丝洞场景关卡，共 20 波。场景小怪可使用“蛛、蛇”等汉字。'),
  4: createLevel(4, '火焰山', '火焰山场景关卡，共 20 波。场景小怪可使用“火、焰”等汉字。'),
} as const

export const ORDERED_STANDARD_LEVEL_IDS: readonly number[] = [1, 2, 3, 4] as const

export const ALL_LEVEL_IDS: readonly number[] = ORDERED_STANDARD_LEVEL_IDS

export function getWavesForLevel(levelId: number): WaveConfig[] | null {
  return LEVEL_CONFIGS[levelId]?.waves ?? null
}
