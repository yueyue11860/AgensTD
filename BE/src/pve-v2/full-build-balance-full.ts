import assert from 'node:assert/strict'
import { PVE_FULL_MATCH_BASE_GROSS_RICE } from './economy'
import {
  runPureSoldierMatrixPoint,
  runRuntimeFullBuildMatrixRuns,
  summarizeRuntimeFullBuildRuns,
  type BalanceMatrixPointSummary,
} from './full-build-simulator'
import type { PveDifficulty } from './balance-catalog'

const MATRIX_POINTS = [
  { difficulty: 'easy', levelId: 1 }, { difficulty: 'easy', levelId: 5 },
  { difficulty: 'easy', levelId: 10 }, { difficulty: 'normal', levelId: 1 },
  { difficulty: 'normal', levelId: 5 }, { difficulty: 'normal', levelId: 10 },
  { difficulty: 'hard', levelId: 1 },
] as const

const TARGETS: Readonly<Record<string, readonly [number, number]>> = {
  'easy:1': [7500, 8500],
  'easy:10': [5500, 7000],
  'normal:10': [4000, 5500],
  'hard:1': [2000, 3500],
}

function parsePositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function parseSeedPrefixes(): readonly string[] {
  const prefixes = (process.env.FULL_BUILD_SEED_PREFIXES ?? 'full-matrix-runtime-a,full-matrix-runtime-b')
    .split(',').map(value => value.trim()).filter(Boolean)
  if (new Set(prefixes).size < 2) throw new Error('FULL_BUILD_SEED_PREFIXES must contain at least two distinct prefixes')
  return prefixes
}

function validateTarget(point: BalanceMatrixPointSummary): string[] {
  const failures: string[] = []
  const range = TARGETS[`${point.difficulty}:${point.levelId}`]
  if (range && (point.clearRateBps < range[0] || point.clearRateBps > range[1])) {
    failures.push(`${point.difficulty} L${point.levelId} clear ${point.clearRateBps}bps outside ${range[0]}-${range[1]}`)
  }
  if (point.clearRateBps > 0) {
    for (const [type, share] of Object.entries(point.soldierDeploymentShareBps)) {
      if (share < 1500) failures.push(`${point.difficulty} L${point.levelId} ${type} deployment share ${share}bps below 1500`)
    }
    for (const [type, share] of Object.entries(point.soldierDamageShareBps)) {
      if (share < 1500) failures.push(`${point.difficulty} L${point.levelId} ${type} damage share ${share}bps below 1500`)
    }
    if (point.topArchetypeVictoryShareBps > 3500) {
      failures.push(`${point.difficulty} L${point.levelId} top build share ${point.topArchetypeVictoryShareBps}bps above 3500`)
    }
  }
  if (point.formedTwoGeneralsRateBps < 9500 || point.synergyActivationRateBps < 9500) {
    failures.push(`${point.difficulty} L${point.levelId} build completion below 95%`)
  }
  return failures
}

export function runFullBuildBalanceMatrix() {
  assert.equal(PVE_FULL_MATCH_BASE_GROSS_RICE, 335)
  const fullSeedsPerArchetypePerPrefix = parsePositiveInteger('FULL_BUILD_SEEDS_PER_ARCHETYPE', 4)
  const pureRuns = parsePositiveInteger('PURE_SOLDIER_MATRIX_RUNS', 128)
  const seedPrefixes = parseSeedPrefixes()
  const matrix = MATRIX_POINTS.map(({ difficulty, levelId }, index) => {
    process.stderr.write(`[balance] point ${index + 1}/${MATRIX_POINTS.length} ${difficulty}:L${levelId} `
      + `(fullSeeds=${fullSeedsPerArchetypePerPrefix}, pureRuns=${pureRuns})\n`)
    const result = {
      pureSoldier: runPureSoldierMatrixPoint(levelId, difficulty as PveDifficulty, pureRuns, 'full-matrix-pure'),
      fullBuild: summarizeRuntimeFullBuildRuns(levelId, difficulty as PveDifficulty,
        seedPrefixes.flatMap(prefix => runRuntimeFullBuildMatrixRuns(levelId, difficulty as PveDifficulty,
          fullSeedsPerArchetypePerPrefix, prefix))),
    }
    process.stderr.write(`[balance] complete ${difficulty}:L${levelId} clear=${result.fullBuild.clearRateBps}bps\n`)
    return result
  })
  const failures = matrix.flatMap(entry => validateTarget(entry.fullBuild))
  const report = { grossRice: PVE_FULL_MATCH_BASE_GROSS_RICE,
    fullSeedsPerArchetypePerPrefix, seedPrefixes, pureRuns, matrix, failures }
  process.stdout.write(`${JSON.stringify(report)}\n`)
  assert.deepEqual(failures, [], `Full-build balance release gate failed:\n${failures.join('\n')}`)
  return report
}

if (require.main === module) runFullBuildBalanceMatrix()
