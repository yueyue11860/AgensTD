import assert from 'node:assert/strict'
import { GENERAL_CATALOG, HOUYI_DEFINITION } from '../core/hero-v1/catalog'
import { GENERAL_IDS } from '../core/hero-v1/roster'
import { SUMMON_UNIT_IDS } from '../core/hero-v1/summon-catalog'
import type {
  GeneralAbilityTargeting,
  GeneralDefinition,
  LevelCurve,
  SummonUnitEffectDefinition,
} from '../core/hero-v1/types'
import { isPveBoardDeployableCell } from './arena'
import { PveGameRuntime } from './runtime'
import type { PveRuntimeSnapshot } from './types'

const fixed = (value: number): LevelCurve => [value, value, value, value, value]
const selfTarget: GeneralAbilityTargeting = { kind: 'self', scope: 'self', targetLimit: 0 }

function summon(
  effectId: string,
  summonUnitId: SummonUnitEffectDefinition['summonUnitId'],
  spawnPattern: SummonUnitEffectDefinition['spawnPattern'],
  targeting?: GeneralAbilityTargeting,
): SummonUnitEffectDefinition {
  return {
    effectId,
    type: 'summon_unit',
    summonUnitId,
    countByLevel: fixed(1),
    durationMsByLevel: fixed(20000),
    maxOwnedAliveByLevel: fixed(1),
    spawnRadiusMilliCellsByLevel: fixed(1000),
    spawnPattern,
    inheritStatRatiosBps: { attack: 5000 },
    sourceInactivePolicy: 'finish_duration',
    ...(targeting ? { targeting } : {}),
    tags: ['spawn_pattern_smoke'],
  }
}

const PATTERN_GENERAL: GeneralDefinition = {
  ...HOUYI_DEFINITION,
  baseStats: {
    ...HOUYI_DEFINITION.baseStats,
    attackRangeMilliCellsByLevel: fixed(10000),
  },
  activeSkill: {
    skillId: 'spawn_pattern_suite',
    skillName: '召唤落点验证',
    trigger: 'auto',
    cooldownMsByLevel: fixed(3000),
    targeting: { kind: 'global', scope: 'all_targetable_enemies', priority: 'furthest_progress', targetLimit: 1 },
    effects: [
      summon('spawn_self', SUMMON_UNIT_IDS.CELESTIAL_SOLDIER, 'self_surrounding_empty_cells', selfTarget),
      summon('spawn_path', SUMMON_UNIT_IDS.MONKEY_SOLDIER, 'path_side_nearest_empty', selfTarget),
      summon('spawn_target', SUMMON_UNIT_IDS.MOON_RABBIT, 'target_surrounding'),
      summon('spawn_random', SUMMON_UNIT_IDS.LOTUS_IMMORTAL_CHILD, 'owner_random_empty_board_cell', selfTarget),
    ],
  },
}

const SUNWUKONG_DEFINITION = GENERAL_CATALOG[GENERAL_IDS.SUNWUKONG]!
const SUNWUKONG_PATH_FIXTURE: GeneralDefinition = {
  ...SUNWUKONG_DEFINITION,
  recipe: { ...SUNWUKONG_DEFINITION.recipe, glyphs: [...HOUYI_DEFINITION.recipe.glyphs] },
  formation: { ...SUNWUKONG_DEFINITION.formation, cellCount: HOUYI_DEFINITION.recipe.glyphs.length },
}

function createFormedRuntime(seed: string): PveGameRuntime {
  const runtime = new PveGameRuntime({
    seed,
    tickRateMs: 100,
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: { 后: 1, 羿: 1 },
    generalCatalog: { [PATTERN_GENERAL.generalId]: PATTERN_GENERAL },
    // 只给阵型两格和一个随机空格，强制验证随机召唤不会落到已有棋子上。
    isDeployableCell: (_slot, x, y) => (x === 11 && y === 11)
      || (x === 12 && y === 11) || (x === 20 && y === 20),
    eventHistoryLimit: 500,
  })
  assert.equal(runtime.registerPlayer('pattern-player', 'P1').ok, true)
  assert.equal(runtime.handleAction('pattern-player', { type: 'RECRUIT_BATCH', actionId: 'recruit' }).ok, true)
  const tray = runtime.snapshot().players[0]!.tray
  for (const [glyph, x] of [['后', 11], ['羿', 12]] as const) {
    const trayIndex = tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === glyph)
    if (trayIndex < 0) throw new Error('seed does not recruit the pattern general')
    assert.equal(runtime.handleAction('pattern-player', {
      type: 'SWAP_TRAY_BOARD', actionId: `deploy-${glyph}`, trayIndex, boardX: x, boardY: 11,
    }).ok, true)
  }
  assert.equal(runtime.start().ok, true)
  return runtime
}

function runSunwukongScenario(seed: string): PveRuntimeSnapshot {
  const runtime = new PveGameRuntime({
    seed,
    tickRateMs: 100,
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: { 后: 1, 羿: 1 },
    generalCatalog: { [SUNWUKONG_PATH_FIXTURE.generalId]: SUNWUKONG_PATH_FIXTURE },
    eventHistoryLimit: 800,
  })
  assert.equal(runtime.registerPlayer('wukong-player', 'P1').ok, true)
  assert.equal(runtime.handleAction('wukong-player', { type: 'RECRUIT_BATCH', actionId: 'recruit' }).ok, true)
  for (const [glyph, x] of [['后', 11], ['羿', 12]] as const) {
    const tray = runtime.snapshot().players[0]!.tray
    const trayIndex = tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === glyph)
    assert.ok(trayIndex >= 0)
    assert.equal(runtime.handleAction('wukong-player', {
      type: 'SWAP_TRAY_BOARD', actionId: `deploy-wukong-${glyph}`, trayIndex, boardX: x, boardY: 11,
    }).ok, true)
  }
  assert.equal(runtime.start().ok, true)
  let snapshot = runtime.snapshot()
  for (let tick = 0; tick < 220 && snapshot.summonedUnits.length < 4; tick += 1) snapshot = runtime.tick()
  assert.equal(snapshot.summonedUnits.length, 4)
  return snapshot
}

function findRecruitSeed(): string {
  for (let index = 0; index < 30000; index += 1) {
    const seed = `spawn-pattern-${index}`
    try {
      createFormedRuntime(seed)
      return seed
    }
    catch {
      // 征兵是确定性随机；继续搜索包含“后、羿”的首批结果。
    }
  }
  throw new Error('Unable to find deterministic summon pattern seed')
}

function runScenario(seed: string): PveRuntimeSnapshot {
  const runtime = createFormedRuntime(seed)
  let snapshot = runtime.snapshot()
  for (let tick = 0; tick < 160 && snapshot.summonedUnits.length < 4; tick += 1) snapshot = runtime.tick()
  assert.equal(snapshot.summonedUnits.length, 4)
  return snapshot
}

export function runSummonSpawnPatternSmokeChecks(): void {
  const seed = findRecruitSeed()
  const first = runScenario(seed)
  const second = runScenario(seed)
  const formation = first.players[0]!.generalFormations[0]!
  const anchor = { x: formation.anchorXMilli, y: formation.anchorYMilli }
  const byUnit = (snapshot: PveRuntimeSnapshot, summonUnitId: string) => {
    const summonState = snapshot.summonedUnits.find((entry) => entry.summonUnitId === summonUnitId)
    assert.ok(summonState)
    return summonState
  }

  const self = byUnit(first, SUMMON_UNIT_IDS.CELESTIAL_SOLDIER)
  assert.equal((self.xMilli - anchor.x) ** 2 + (self.yMilli - anchor.y) ** 2, 1000 ** 2)

  const path = byUnit(first, SUMMON_UNIT_IDS.MONKEY_SOLDIER)
  assert.ok((path.xMilli - anchor.x) ** 2 + (path.yMilli - anchor.y) ** 2 > 1000 ** 2,
    'path-side summon must be derived from the nearest route, not the caster ring')

  const targetSummon = byUnit(first, SUMMON_UNIT_IDS.MOON_RABBIT)
  const targetSpawnEvent = first.recentEvents.find((event) => event.type === 'SUMMON_SPAWNED'
    && event.data.summonId === targetSummon.id)
  assert.ok(targetSpawnEvent)
  assert.equal(typeof targetSpawnEvent.data.targetXMilli, 'number')
  assert.equal(typeof targetSpawnEvent.data.targetYMilli, 'number')
  assert.equal((targetSummon.xMilli - Number(targetSpawnEvent.data.targetXMilli)) ** 2
    + (targetSummon.yMilli - Number(targetSpawnEvent.data.targetYMilli)) ** 2, 1000 ** 2)

  const random = byUnit(first, SUMMON_UNIT_IDS.LOTUS_IMMORTAL_CHILD)
  const repeatedRandom = byUnit(second, SUMMON_UNIT_IDS.LOTUS_IMMORTAL_CHILD)
  assert.deepEqual({ x: random.xMilli, y: random.yMilli }, { x: repeatedRandom.xMilli, y: repeatedRandom.yMilli })
  assert.equal(random.xMilli % 1000, 0)
  assert.equal(random.yMilli % 1000, 0)
  assert.equal(isPveBoardDeployableCell(random.xMilli / 1000, random.yMilli / 1000), true)
  assert.deepEqual({ x: random.xMilli, y: random.yMilli }, { x: 20000, y: 20000 })
  assert.equal(new Set(first.summonedUnits.map((entry) => `${entry.xMilli},${entry.yMilli}`)).size, 4)

  const wukong = runSunwukongScenario(seed)
  const wukongFormation = wukong.players[0]!.generalFormations[0]!
  const monkeySummons = wukong.summonedUnits.filter((entry) => entry.sourceGeneralId === GENERAL_IDS.SUNWUKONG)
  assert.equal(monkeySummons.length, 4)
  assert.equal(SUNWUKONG_DEFINITION.activeSkill.effects.some((effect) => effect.type === 'summon_unit'
    && effect.spawnPattern === 'path_side_nearest_empty'), true)
  for (const monkey of monkeySummons) {
    assert.ok((monkey.xMilli - wukongFormation.anchorXMilli) ** 2
      + (monkey.yMilli - wukongFormation.anchorYMilli) ** 2 > 1000 ** 2,
    '孙悟空毫毛分身必须生成在最近路径侧，不得落在本体周围 1 格')
  }
}

if (require.main === module) {
  runSummonSpawnPatternSmokeChecks()
  console.log('pve-v2 summon spawn pattern smoke checks passed')
}
