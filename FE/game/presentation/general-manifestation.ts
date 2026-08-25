export type GeneralManifestationId = 'houyi' | 'yangjian' | 'unknown'
export type GeneralActionKind = 'basic' | 'skill'
export type GeneralActionVisual = 'sun-arrow' | 'three-point-blade' | 'generic'

export interface ManifestationPoint {
  x: number
  y: number
}

export interface GeneralManifestationRecipe {
  id: GeneralManifestationId
  name: string
  glyphs: readonly string[]
  basicVisual: GeneralActionVisual
  skillVisual: GeneralActionVisual
  skillIds: readonly string[]
  color: number
  accent: number
  audioMotif: 'houyi' | 'yangjian' | 'generic'
}

export interface GeneralActionPath {
  source: ManifestationPoint
  targets: ManifestationPoint[]
  segments: Array<{ from: ManifestationPoint, to: ManifestationPoint }>
}

export interface MoonPalaceLink {
  synergyId: 'moon_palace_companions'
  name: '月宫旧侣'
  memberGeneralIds: readonly ['houyi', 'chang_e']
}

const GENERIC_RECIPE: GeneralManifestationRecipe = {
  id: 'unknown',
  name: '神将',
  glyphs: [],
  basicVisual: 'generic',
  skillVisual: 'generic',
  skillIds: [],
  color: 0xc084fc,
  accent: 0xf5f3ff,
  audioMotif: 'generic',
}

const RECIPES: Readonly<Record<'houyi' | 'yangjian', GeneralManifestationRecipe>> = {
  houyi: {
    id: 'houyi',
    name: '后羿',
    glyphs: ['后', '羿'],
    basicVisual: 'sun-arrow',
    skillVisual: 'sun-arrow',
    skillIds: ['chuanyun_zhurijian'],
    color: 0xf6c453,
    accent: 0xfff3b0,
    audioMotif: 'houyi',
  },
  yangjian: {
    id: 'yangjian',
    name: '杨戬',
    glyphs: ['杨', '戬'],
    basicVisual: 'three-point-blade',
    skillVisual: 'three-point-blade',
    skillIds: ['yangjian_sanjian_liangrenzhan'],
    color: 0x8bd3dd,
    accent: 0xe6fbff,
    audioMotif: 'yangjian',
  },
}

export const MOON_PALACE_LINK: MoonPalaceLink = {
  synergyId: 'moon_palace_companions',
  name: '月宫旧侣',
  memberGeneralIds: ['houyi', 'chang_e'],
}

/** Pure semantic selection. Unknown ids never inherit a named hero's choreography. */
export function generalManifestationRecipe(generalId?: string | null): GeneralManifestationRecipe {
  if (!generalId) return GENERIC_RECIPE
  return RECIPES[generalId.trim().toLowerCase() as keyof typeof RECIPES] ?? GENERIC_RECIPE
}

export function generalActionVisual(
  generalId: string | null | undefined,
  actionKind: GeneralActionKind,
  skillId?: string | null,
): GeneralActionVisual {
  const recipe = generalManifestationRecipe(generalId)
  if (recipe.id === 'unknown') return 'generic'
  if (actionKind === 'basic') return recipe.basicVisual
  // A known hero with an unknown skill is deliberately generic: protocol/catalog drift must not lie visually.
  return skillId && recipe.skillIds.includes(skillId) ? recipe.skillVisual : 'generic'
}

/** Builds only server-supplied target segments; it never predicts range, cone or penetration victims. */
export function buildGeneralActionPath(
  source: ManifestationPoint,
  targets: readonly ManifestationPoint[],
): GeneralActionPath {
  const deduplicated: ManifestationPoint[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) continue
    const key = `${target.x}:${target.y}`
    if (seen.has(key)) continue
    seen.add(key)
    deduplicated.push({ x: target.x, y: target.y })
  }
  return {
    source: { x: source.x, y: source.y },
    targets: deduplicated,
    segments: deduplicated.map((target) => ({ from: { x: source.x, y: source.y }, to: target })),
  }
}

export function isMoonPalaceSynergy(synergyId?: string | null): boolean {
  return synergyId === MOON_PALACE_LINK.synergyId
}
