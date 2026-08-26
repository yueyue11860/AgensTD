import assert from 'node:assert/strict'
import {
  COMPACT_ENEMY_RENDER_THRESHOLD,
  compactEnemyHealthPixels,
  enemySnapshotInterpolationDurationMs,
  enemyTargetChanged,
  interpolateEnemyPosition,
  shouldUseCompactEnemyRendering,
} from './enemy-render-budget.ts'

assert.equal(shouldUseCompactEnemyRendering(6), false, 'small encounters retain detailed rendering')
assert.equal(shouldUseCompactEnemyRendering(COMPACT_ENEMY_RENDER_THRESHOLD), false)
assert.equal(shouldUseCompactEnemyRendering(80), true)
assert.equal(compactEnemyHealthPixels(700, 1000, 26), 18)
assert.equal(compactEnemyHealthPixels(-1, 1000, 26), 0)
assert.equal(compactEnemyHealthPixels(2000, 1000, 26), 26)
assert.equal(enemyTargetChanged(10, 20, 10, 20), false, 'same authoritative target must not restart interpolation')
assert.equal(enemyTargetChanged(10, 20, 10.032, 20), true, 'one milliscale-cell pixel step remains visible')
assert.equal(enemySnapshotInterpolationDurationMs({ previousTick: 10, currentTick: 12, tickRateMs: 100 }), 220)
assert.equal(enemySnapshotInterpolationDurationMs({ previousTick: 12, currentTick: 12, tickRateMs: 100, fallbackMs: 220 }), 220)
assert.equal(enemySnapshotInterpolationDurationMs({ previousTick: 10, currentTick: 30, tickRateMs: 100 }), 320, 'network stalls are bounded')
assert.deepEqual(interpolateEnemyPosition({
  fromX: 0, fromY: 10, targetX: 20, targetY: 30, startedAt: 100, durationMs: 200, now: 200, reducedMotion: false,
}), { x: 10, y: 20, progress: 0.5 })
assert.deepEqual(interpolateEnemyPosition({
  fromX: 0, fromY: 10, targetX: 20, targetY: 30, startedAt: 100, durationMs: 200, now: 100, reducedMotion: true,
}), { x: 20, y: 30, progress: 1 })
const frameSamples = Array.from({ length: 13 }, (_, index) => interpolateEnemyPosition({
  fromX: 0,
  fromY: 0,
  targetX: 6.4,
  targetY: 0,
  startedAt: 0,
  durationMs: 220,
  now: index * (220 / 12),
  reducedMotion: false,
}).x)
assert.equal(new Set(frameSamples).size, frameSamples.length, 'subpixel interpolation advances on every rendered frame')
assert.ok(frameSamples.slice(1).every((position, index) => position > frameSamples[index]), 'movement is monotonic')

console.log(JSON.stringify({
  ok: true,
  detailedEnemyCeiling: COMPACT_ENEMY_RENDER_THRESHOLD,
  compactAt80: true,
  healthPixelClamping: true,
  sameTargetRetargetSuppression: true,
  authoritativeCadenceInterpolation: true,
  packetJitterGrace: true,
  monotonicSubpixelFrames: true,
  globalInterpolation: true,
  reducedMotionImmediate: true,
}))
