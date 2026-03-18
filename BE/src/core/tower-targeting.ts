import type { EnemyState, TowerState, TowerTargetingStrategy } from '../domain/game-state'

type TargetComparator = (tower: TowerState, candidate: EnemyState, incumbent: EnemyState) => boolean

function distanceBetween(tower: TowerState, enemy: EnemyState) {
  return Math.hypot(enemy.x - tower.x, enemy.y - tower.y)
}

function getRemainingPathDistance(enemy: EnemyState) {
  return enemy.path.length === 0 ? Number.POSITIVE_INFINITY : enemy.path.length - 1
}

const targetComparators: Record<TowerTargetingStrategy, TargetComparator> = {
  nearest: (tower, candidate, incumbent) => {
    const candidateDistance = distanceBetween(tower, candidate)
    const incumbentDistance = distanceBetween(tower, incumbent)
    return candidateDistance < incumbentDistance
  },
  first: (_tower, candidate, incumbent) => {
    const candidateRemaining = getRemainingPathDistance(candidate)
    const incumbentRemaining = getRemainingPathDistance(incumbent)
    return candidateRemaining < incumbentRemaining || (
      candidateRemaining === incumbentRemaining
      && candidate.hp > incumbent.hp
    )
  },
  strongest: (_tower, candidate, incumbent) => {
    return candidate.hp > incumbent.hp || (
      candidate.hp === incumbent.hp
      && getRemainingPathDistance(candidate) < getRemainingPathDistance(incumbent)
    )
  },
}

export function selectEnemyTarget(
  tower: TowerState,
  enemies: EnemyState[],
  strategy: TowerTargetingStrategy,
) {
  const comparator = targetComparators[strategy]
  let winner: EnemyState | null = null

  for (const enemy of enemies) {
    if (distanceBetween(tower, enemy) > tower.range) {
      continue
    }

    if (!winner || comparator(tower, enemy, winner)) {
      winner = enemy
    }
  }

  return winner
}