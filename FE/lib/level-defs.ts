import { PVE_STAGE_DEFINITIONS, type PveMinionGlyph, type PveSceneTheme } from '../../shared/contracts/pve-stage-config'

export interface LevelDef {
  levelId: number
  label: string
  subtitle: string
  description: string
  minionGlyphs: readonly PveMinionGlyph[]
  sceneTheme: PveSceneTheme
  bossTheme: string
  clearRate: number
  minPlayers: number
  allowedPlayerKinds: Array<'human' | 'agent'>
  hidden: boolean
  danger: boolean
}

/** 前后端共用同一份西游 PVE 关卡权威配置。 */
export const LEVEL_DEFS: readonly LevelDef[] = PVE_STAGE_DEFINITIONS.map((definition) => ({
  levelId: definition.levelId,
  label: definition.label,
  subtitle: `20 波 · ${definition.subtitle}`,
  description: definition.description,
  minionGlyphs: definition.minionGlyphs,
  sceneTheme: definition.sceneTheme,
  bossTheme: definition.bossTheme,
  clearRate: 0,
  minPlayers: 1,
  allowedPlayerKinds: ['human', 'agent'],
  hidden: false,
  danger: false,
}))
