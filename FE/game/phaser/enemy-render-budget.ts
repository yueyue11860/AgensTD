// A detailed enemy is a container of eight Graphics/Text children. Even a
// dozen of them costs more to draw than eighty precomposed enemy sprites.
// Preserve the richer close-up treatment for small encounters only.
export const COMPACT_ENEMY_RENDER_THRESHOLD = 8
export const MIN_ENEMY_INTERPOLATION_MS = 80
export const MAX_ENEMY_INTERPOLATION_MS = 320
export const ENEMY_INTERPOLATION_GRACE_FACTOR = 1.1

export function shouldUseCompactEnemyRendering(enemyCount: number): boolean {
  return Number.isFinite(enemyCount) && enemyCount > COMPACT_ENEMY_RENDER_THRESHOLD
}

export function compactEnemyHealthPixels(hp: number, maxHp: number, width: number): number {
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
  return Math.round(Math.max(0, width) * ratio)
}

export function enemyTargetChanged(
  currentTargetX: number,
  currentTargetY: number,
  nextTargetX: number,
  nextTargetY: number,
): boolean {
  // Projected coordinates use milliscale cells. Keep a tiny tolerance for the
  // grid-to-pixel multiplication without swallowing a real server movement.
  return Math.abs(currentTargetX - nextTargetX) > 0.001
    || Math.abs(currentTargetY - nextTargetY) > 0.001
}

export function enemySnapshotInterpolationDurationMs(input: {
  previousTick: number | null
  currentTick: number
  tickRateMs: number
  fallbackMs?: number
}): number {
  const tickRateMs = Number.isFinite(input.tickRateMs) && input.tickRateMs > 0
    ? input.tickRateMs
    : 100
  const tickDelta = input.previousTick === null ? 0 : input.currentTick - input.previousTick
  const rawDuration = tickDelta > 0
    // Keep a small interpolation buffer so ordinary packet jitter does not let
    // an enemy reach its target and visibly pause before the next snapshot.
    ? tickDelta * tickRateMs * ENEMY_INTERPOLATION_GRACE_FACTOR
    : input.fallbackMs ?? tickRateMs * 2
  return Math.round(Math.max(MIN_ENEMY_INTERPOLATION_MS, Math.min(MAX_ENEMY_INTERPOLATION_MS, rawDuration)))
}

export function interpolateEnemyPosition(input: {
  fromX: number
  fromY: number
  targetX: number
  targetY: number
  startedAt: number
  durationMs: number
  now: number
  reducedMotion: boolean
}) {
  const progress = input.reducedMotion || input.durationMs <= 0
    ? 1
    : Math.max(0, Math.min(1, (input.now - input.startedAt) / input.durationMs))
  return {
    x: input.fromX + (input.targetX - input.fromX) * progress,
    y: input.fromY + (input.targetY - input.fromY) * progress,
    progress,
  }
}
