"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectEnemyTarget = selectEnemyTarget;
function distanceBetween(tower, enemy) {
    return Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
}
function getRemainingPathDistance(enemy) {
    return enemy.path.length === 0 ? Number.POSITIVE_INFINITY : enemy.path.length - 1;
}
const targetComparators = {
    nearest: (tower, candidate, incumbent) => {
        const candidateDistance = distanceBetween(tower, candidate);
        const incumbentDistance = distanceBetween(tower, incumbent);
        return candidateDistance < incumbentDistance;
    },
    first: (_tower, candidate, incumbent) => {
        const candidateRemaining = getRemainingPathDistance(candidate);
        const incumbentRemaining = getRemainingPathDistance(incumbent);
        return candidateRemaining < incumbentRemaining || (candidateRemaining === incumbentRemaining
            && candidate.hp > incumbent.hp);
    },
    strongest: (_tower, candidate, incumbent) => {
        return candidate.hp > incumbent.hp || (candidate.hp === incumbent.hp
            && getRemainingPathDistance(candidate) < getRemainingPathDistance(incumbent));
    },
};
function selectEnemyTarget(tower, enemies, strategy) {
    const comparator = targetComparators[strategy];
    let winner = null;
    for (const enemy of enemies) {
        if (distanceBetween(tower, enemy) > tower.range) {
            continue;
        }
        if (!winner || comparator(tower, enemy, winner)) {
            winner = enemy;
        }
    }
    return winner;
}
