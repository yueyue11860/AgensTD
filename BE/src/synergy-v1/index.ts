export {
  GENERAL_DEVELOPMENT_SEQUENCE,
  GENERAL_SYNERGY_IDS_BY_GENERAL,
  GENERAL_SYNERGY_PROFILES,
  MOON_PALACE_COMPANIONS,
  SYNERGY_V1_CATALOG,
  validateGeneralDevelopmentSequence,
} from './catalog'
export {
  evaluatePlayerSynergies,
  reconcilePlayerSynergies,
  validateSynergyCatalog,
} from './engine'
export {
  projectHeroV1GeneralStatModifiers,
  toHeroV1GeneralStatModifiers,
} from './hero-v1-adapter'
export type {
  HeroV1SynergyProjection,
  HeroV1UnprojectedSynergyEffectReason,
} from './hero-v1-adapter'
export {
  SynergyRuntimeProjectionRegistry,
  settleRuntimeSynergyParameter,
  settleRuntimeSynergyStat,
} from './runtime-projection'
export type {
  RuntimeSynergyEffectSource,
  RuntimeSynergyParameterPatch,
  RuntimeSynergyQueryExclusionReason,
  RuntimeSynergyStatModifier,
  SynergyRuntimeQuery,
  SynergyRuntimeQueryResult,
  SynergyRuntimeSubject,
  SynergySourceRegistryApplyResult,
} from './runtime-projection'
export {
  SYNERGY_GLOBAL_LIMITS,
  inheritSummonStats,
  settleNumericStat,
  settleSkillCooldownMs,
} from './settlement'
export type { NumericModifier, SummonInheritanceEntry } from './settlement'
export type {
  ActiveSynergyState,
  GeneralFacetDimension,
  GeneralFormationProjection,
  GeneralProfession,
  GeneralRuntimeZone,
  GeneralSynergyProfile,
  PlayerSynergyEvaluation,
  SynergyActivationLevel,
  SynergyCategory,
  SynergyDefinition,
  SynergyEffect,
  SynergyEffectCondition,
  SynergyEffectTarget,
  SynergyReconcileCommand,
  SynergyReconcileResult,
  SynergyRequirement,
  SynergyStat,
} from './types'
