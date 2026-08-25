export type EnemyVisualRole = 'basic' | 'fast' | 'armored' | 'mystic' | 'swarm' | 'boss' | 'unknown'
export type EnemySilhouette = 'circle' | 'diamond' | 'hexagon' | 'triangle' | 'cluster' | 'octagon' | 'rounded-square'
export type BossTelegraphPattern = 'sector' | 'impact' | 'ring'

export interface EnemyVisualInput {
  entityId: string
  entityKind: 'ordinary_minion' | 'boss'
  glyph: string
  bossDefinitionId?: string | null
  bossName?: string | null
  /** Forward-compatible protocol field; the current server does not project it yet. */
  enemyRole?: string | null
  armor?: number
  magicResistance?: number
  moveSpeedMilliCellsPerSecond?: number
}

export interface EnemyVisualStyle {
  role: EnemyVisualRole
  label: string
  marker: string
  silhouette: EnemySilhouette
  fillColor: number
  outlineColor: number
  moveDurationMs: number
  moveEase: string
}

export interface PresentationBudgetPreferences {
  reducedMotion: boolean
  lowEffects: boolean
}

const EXPLICIT_ROLE_ALIASES: Readonly<Record<string, EnemyVisualRole>> = {
  base: 'basic',
  basic: 'basic',
  normal: 'basic',
  fast: 'fast',
  swift: 'fast',
  armored: 'armored',
  armour: 'armored',
  tank: 'armored',
  magic: 'mystic',
  mystic: 'mystic',
  spirit: 'mystic',
  swarm: 'swarm',
  horde: 'swarm',
  boss: 'boss',
}

const GLYPH_ROLE: Readonly<Record<string, EnemyVisualRole>> = {
  '鬼': 'basic',
  '虎': 'basic',
  '妖': 'fast',
  '豹': 'fast',
  '鹰': 'fast',
  '蛇': 'fast',
  '魔': 'armored',
  '熊': 'armored',
  '狮': 'armored',
  '象': 'armored',
  '骨': 'armored',
  '魅': 'mystic',
  '蝎': 'mystic',
  '怪': 'swarm',
  '蛛': 'swarm',
}

const ROLE_STYLES: Readonly<Record<EnemyVisualRole, EnemyVisualStyle>> = {
  basic: { role: 'basic', label: '基础', marker: '卒', silhouette: 'circle', fillColor: 0x3f1d24, outlineColor: 0xf2b6a8, moveDurationMs: 220, moveEase: 'Linear' },
  fast: { role: 'fast', label: '疾行', marker: '疾', silhouette: 'diamond', fillColor: 0x123c3d, outlineColor: 0x8ee3cf, moveDurationMs: 125, moveEase: 'Expo.Out' },
  armored: { role: 'armored', label: '重甲', marker: '甲', silhouette: 'hexagon', fillColor: 0x34302a, outlineColor: 0xf0cf7b, moveDurationMs: 300, moveEase: 'Linear' },
  mystic: { role: 'mystic', label: '灵咒', marker: '灵', silhouette: 'triangle', fillColor: 0x30264d, outlineColor: 0xd7c0ff, moveDurationMs: 235, moveEase: 'Sine.InOut' },
  swarm: { role: 'swarm', label: '群怪', marker: '群', silhouette: 'cluster', fillColor: 0x3c2920, outlineColor: 0xf3b777, moveDurationMs: 165, moveEase: 'Back.Out' },
  boss: { role: 'boss', label: '妖王', marker: '王', silhouette: 'octagon', fillColor: 0x561b24, outlineColor: 0xf2c45c, moveDurationMs: 260, moveEase: 'Sine.InOut' },
  unknown: { role: 'unknown', label: '异怪', marker: '异', silhouette: 'rounded-square', fillColor: 0x292b38, outlineColor: 0xe2e8f0, moveDurationMs: 220, moveEase: 'Linear' },
}

function normalizedRole(value: string | null | undefined): EnemyVisualRole | null {
  if (!value) return null
  return EXPLICIT_ROLE_ALIASES[value.trim().toLowerCase()] ?? null
}

/**
 * Resolve presentation role without mutating combat state. Explicit protocol data wins;
 * current snapshots fall back to stats and the stable five-glyph minion vocabulary.
 */
export function resolveEnemyVisualRole(enemy: EnemyVisualInput): EnemyVisualRole {
  if (enemy.entityKind === 'boss') return 'boss'
  const explicit = normalizedRole(enemy.enemyRole)
  if (explicit && explicit !== 'boss') return explicit

  const speed = enemy.moveSpeedMilliCellsPerSecond ?? 1000
  const armor = enemy.armor ?? 0
  const resistance = enemy.magicResistance ?? 0
  if (speed >= 1150) return 'fast'
  if (armor - resistance >= 6) return 'armored'
  if (resistance - armor >= 6) return 'mystic'

  const semantic = `${enemy.entityId} ${enemy.bossDefinitionId ?? ''} ${enemy.bossName ?? ''}`.toLowerCase()
  if (/swarm|horde|cluster|群|蜂|蛛/.test(semantic)) return 'swarm'
  if (/fast|swift|runner|疾|影/.test(semantic)) return 'fast'
  if (/armor|armour|tank|甲|盾/.test(semantic)) return 'armored'
  if (/mystic|spirit|caster|灵|咒|法/.test(semantic)) return 'mystic'
  return GLYPH_ROLE[enemy.glyph] ?? 'unknown'
}

export function enemyVisualStyle(enemy: EnemyVisualInput): EnemyVisualStyle {
  return ROLE_STYLES[resolveEnemyVisualRole(enemy)]
}

export function enemyMoveProfile(enemy: EnemyVisualInput, preferences: PresentationBudgetPreferences): { durationMs: number, ease: string } {
  if (preferences.reducedMotion) return { durationMs: 0, ease: 'Linear' }
  const style = enemyVisualStyle(enemy)
  return {
    durationMs: preferences.lowEffects ? Math.max(90, Math.round(style.moveDurationMs * 0.72)) : style.moveDurationMs,
    ease: preferences.lowEffects ? 'Linear' : style.moveEase,
  }
}

export function bossTelegraphPattern(pluginId?: string | null, skillId?: string | null, skillName?: string | null): BossTelegraphPattern {
  const semantic = `${pluginId ?? ''} ${skillId ?? ''} ${skillName ?? ''}`.toLowerCase()
  if (/lane_minion_haste|lane|charge|rush|号令|冲阵|奔袭/.test(semantic)) return 'sector'
  if (/phase_guard|guard|slam|impact|护体|震地|降临/.test(semantic)) return 'impact'
  return 'ring'
}

export function telegraphProgress(startedAtTick: number, executeAtTick: number, currentTick: number): { progress: number, remainingTicks: number } {
  const totalTicks = Math.max(1, executeAtTick - startedAtTick)
  const remainingTicks = Math.max(0, executeAtTick - currentTick)
  return {
    progress: Math.max(0, Math.min(1, 1 - remainingTicks / totalTicks)),
    remainingTicks,
  }
}

function cuePriority(kind: string): number {
  if (kind === 'boss-death' || kind === 'boss-warning' || kind === 'boss-spawn' || kind === 'boss-phase') return 5
  if (kind === 'death' || kind === 'wave-start' || kind === 'general-formed' || kind === 'synergy') return 4
  if (kind === 'damage' || kind === 'general-action' || kind === 'general-status') return 3
  if (kind === 'general-state') return 2
  return 1
}

/** Keeps event order while dropping low-priority flourish above the per-frame VFX budget. */
export function withinPresentationBudget<T extends { kind: string }>(cues: readonly T[], preferences: PresentationBudgetPreferences): T[] {
  const limit = preferences.reducedMotion ? 6 : preferences.lowEffects ? 14 : 36
  if (cues.length <= limit) return [...cues]
  const selected = cues
    .map((cue, index) => ({ cue, index, priority: cuePriority(cue.kind) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
  return selected.map(entry => entry.cue)
}
