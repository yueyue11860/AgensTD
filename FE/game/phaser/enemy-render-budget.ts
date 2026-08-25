export const COMPACT_ENEMY_RENDER_THRESHOLD = 40

export function shouldUseCompactEnemyRendering(enemyCount: number): boolean {
  return Number.isFinite(enemyCount) && enemyCount > COMPACT_ENEMY_RENDER_THRESHOLD
}

export function compactEnemyHealthPixels(hp: number, maxHp: number, width: number): number {
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
  return Math.round(Math.max(0, width) * ratio)
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
