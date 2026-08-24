export interface LevelDef {
  levelId: number
  label: string
  subtitle: string
  clearRate: number
  minPlayers: number
  allowedPlayerKinds: Array<'human' | 'agent'>
  hidden: boolean
  danger: boolean
}

function scene(levelId: number, label: string, subtitle: string): LevelDef {
  return {
    levelId,
    label,
    subtitle,
    clearRate: 0,
    minPlayers: 1,
    allowedPlayerKinds: ['human', 'agent'],
    hidden: false,
    danger: false,
  }
}

/** 新版 PVE 关卡统一 20 波，关卡之间仅以西游场景区分。 */
export const LEVEL_DEFS: readonly LevelDef[] = [
  scene(1, '花果山', '20 波 · 花果山群妖'),
  scene(2, '流沙河', '20 波 · 水族妖怪'),
  scene(3, '盘丝洞', '20 波 · 蛛蛇魅影'),
  scene(4, '火焰山', '20 波 · 烈焰群魔'),
] as const
