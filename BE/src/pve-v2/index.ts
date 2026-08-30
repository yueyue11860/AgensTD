export { PVE_WAVE_PREP_DURATION_MS, PveGameRuntime } from './runtime'
export {
  PVE_BALANCE_CATALOG_REVISION,
  PVE_COMBAT_RULESET_VERSION,
  PVE_MATCH_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  PVE_STAGE_CATALOG_REVISION,
  createPveMatchConfigSnapshot,
} from './ruleset'
export type { PveMatchConfigSnapshot } from './ruleset'
export {
  PVE_BOSS_RICE_REWARD_BY_WAVE,
  PVE_CONTROL_XP_SHARE_CAP_BPS,
  PVE_FULL_MATCH_BASE_GROSS_RICE,
  PVE_ORDINARY_ENEMY_RICE_REWARD,
  PVE_PAID_RECRUIT_SOFT_CAP_BATCHES,
  PVE_STARTING_RICE,
  allocatePveBaseXpByContribution,
  resolvePveBossRiceReward,
  resolvePveLaneClearRiceReward,
  resolvePvePaidRecruitBaseCost,
} from './economy'
export type { PveXpContributionCategory, PveXpContributionIdentity } from './economy'
export { DeterministicPrng } from './prng'
export {
  PVE_BALANCE_LEVEL_MAX,
  PVE_BALANCE_LEVEL_MIN,
  PVE_BALANCE_WAVE_COUNT,
  PVE_BASE_ARMOR_BY_WAVE,
  PVE_BASE_HP_BY_WAVE,
  PVE_BASE_MAGIC_RESISTANCE_BY_WAVE,
  PVE_DIFFICULTIES,
  getResolvedPveWave,
  physicalEffectiveHealth,
  resolvePveBalanceProfile,
  resolvePveWaveCatalog,
  validatePveBalanceCatalog,
} from './balance-catalog'
export type { PveBalanceProfile, PveDifficulty, ResolvedPveBalanceCatalog } from './balance-catalog'
export {
  SOLDIER_CATALOG,
  SOLDIER_TYPES,
  WAVE_MINION_CATALOG,
  getSoldierCatalogEntry,
  getWaveMinionCatalogEntry,
  validatePveV2Catalogs,
} from './catalogs'
export {
  DEFAULT_PVE_LANE_ROUTES,
  PVE_ARENA_GRID_SIZE,
  PVE_ENEMY_BODY_RADIUS_MILLI,
  PVE_LANE_SLOTS,
  PVE_SPAWN_SQUARE_MAX,
  PVE_SPAWN_SQUARE_MIN,
  getDefaultSoldierPlacement,
  belongsToSlotQuadrant,
  hasEnemyBodyFullyExitedPveSpawnSquareMilli,
  isDefaultDeployableCell,
  isPveBoardDeployableCell,
} from './arena'
export { runPveV2SmokeChecks } from './smoke'
export { runPveBalanceSmokeChecks } from './balance-smoke'
export {
  BOSS_RUNTIME_SCHEMA_VERSION,
  BossCombatRuntimeV1,
  isLaneWaveSpawningComplete,
  nextLaneSpawnEntityKind,
  settleBossControlDurationMs,
  settleEnemySlowBps,
} from './boss-runtime'
export { runBossRuntimeSmokeChecks } from './boss-runtime-smoke'
export { runGeneralSelectionSmoke } from './general-selection-smoke'
export {
  runPureSoldierMonteCarlo,
  simulateFixedSoldierWave,
  simulatePureSoldierEconomyRun,
} from './balance-simulator'
export type {
  FixedWaveSimulationResult,
  PureSoldierEconomyRun,
  PureSoldierMonteCarloSummary,
  SoldierStack,
} from './balance-simulator'
export type {
  PveGameRuntimeOptions,
  PveGeneralSelection,
  PveEnemySnapshot,
  PveBossActiveCastSnapshot,
  PveLaneRoute,
  PveLaneSlot,
  PvePiece,
  PvePlayerSnapshot,
  PveRuntimeAction,
  SetTutorialPausedAction,
  PveRuntimeEvent,
  PveRuntimeResult,
  PveRuntimeSnapshot,
  SoldierLevel,
  SoldierPiece,
  SoldierType,
} from './types'
