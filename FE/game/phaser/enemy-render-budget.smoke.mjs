import assert from 'node:assert/strict'
import {
  COMPACT_ENEMY_RENDER_THRESHOLD,
  compactEnemyHealthPixels,
  interpolateEnemyPosition,
  shouldUseCompactEnemyRendering,
} from './enemy-render-budget.ts'

assert.equal(shouldUseCompactEnemyRendering(20), false, 'normal encounters retain detailed rendering')
assert.equal(shouldUseCompactEnemyRendering(COMPACT_ENEMY_RENDER_THRESHOLD), false)
assert.equal(shouldUseCompactEnemyRendering(80), true)
assert.equal(compactEnemyHealthPixels(700, 1000, 26), 18)
assert.equal(compactEnemyHealthPixels(-1, 1000, 26), 0)
assert.equal(compactEnemyHealthPixels(2000, 1000, 26), 26)
assert.deepEqual(interpolateEnemyPosition({
  fromX: 0, fromY: 10, targetX: 20, targetY: 30, startedAt: 100, durationMs: 200, now: 200, reducedMotion: false,
}), { x: 10, y: 20, progress: 0.5 })
assert.deepEqual(interpolateEnemyPosition({
  fromX: 0, fromY: 10, targetX: 20, targetY: 30, startedAt: 100, durationMs: 200, now: 100, reducedMotion: true,
}), { x: 20, y: 30, progress: 1 })

console.log(JSON.stringify({
  ok: true,
  detailedEnemyCeiling: COMPACT_ENEMY_RENDER_THRESHOLD,
  compactAt80: true,
  healthPixelClamping: true,
  globalInterpolation: true,
  reducedMotionImmediate: true,
}))
