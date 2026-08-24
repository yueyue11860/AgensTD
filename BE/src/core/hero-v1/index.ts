export {
  cumulativeExperienceRequiredForLevel,
  fullRankExperienceRequired,
  GENERAL_CATALOG,
  GENERAL_EXPERIENCE_POINT_SCALE,
  getGeneralDefinition,
  getGeneralLevelValue,
  HOUYI_DEFINITION,
  HOUYI_GENERAL_ID,
  levelForExperience,
  resolveGeneralStats,
  validateGeneralDefinition,
} from './catalog'
export {
  initializeGeneralCombatTimers,
  planGeneralCombatFrame,
  selectGeneralTarget,
} from './combat-engine'
export { GeneralFormationManager } from './formation-manager'
export type {
  DirectDamageEffectDefinition,
  FixedFormationMovePlan,
  FormationReconcileResult,
  GeneralArchetype,
  GeneralCombatEnemy,
  GeneralCombatPlan,
  GeneralDefinition,
  GeneralFormationState,
  GeneralLevel,
  GeneralProgressState,
  GeneralQuality,
  GeneralStat,
  GeneralStatModifier,
  HeroCharacterToken,
  LevelCurve,
  PlannedGeneralAttack,
  ResolvedGeneralStats,
} from './types'
