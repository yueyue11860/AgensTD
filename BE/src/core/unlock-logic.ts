import {
  PVE_DIFFICULTY_LABELS,
  PVE_STAGE_SELECTIONS,
  getPveStageDefinition,
  isPveStageSelection,
  pveStageKey,
  type PveDifficulty,
  type PveProgressionView,
  type PveStageKey,
  type PveStageSelection,
  type PveStageUnlockState,
} from '../../../shared/contracts/pve-stage-config'
import type { PveProgressPayload } from '../account-v1/types'
import { ALL_LEVEL_IDS } from '../config/level-config'
import type { UserProgress, UnlockCheckResult } from '../domain/progress'

export function createDefaultPveProgress(): PveProgressPayload {
  return { version: 1, clearsByStageKey: {} }
}

export function clearedPveStageKeys(progress: Readonly<PveProgressPayload>): Set<PveStageKey> {
  const cleared = new Set<PveStageKey>()
  for (const [storedKey, record] of Object.entries(progress.clearsByStageKey)) {
    if (!record || !isPveStageSelection(record.selection)) continue
    const canonicalKey = pveStageKey(record.selection)
    if (storedKey === canonicalKey && record.stageKey === canonicalKey && record.clearCount > 0) {
      cleared.add(canonicalKey)
    }
  }
  return cleared
}

export function prerequisiteStageKeys(selection: PveStageSelection): readonly PveStageKey[] {
  if (!isPveStageSelection(selection)) return []
  const keys = (difficulty: PveDifficulty, from: number, to: number): PveStageKey[] => Array.from(
    { length: Math.max(0, to - from + 1) },
    (_, index) => pveStageKey({ levelId: from + index, difficulty }),
  )

  if (selection.difficulty === 'easy') {
    return selection.levelId === 1
      ? []
      : [pveStageKey({ levelId: selection.levelId - 1, difficulty: 'easy' })]
  }
  if (selection.difficulty === 'normal') {
    return keys('easy', 1, selection.levelId <= 5 ? 5 : selection.levelId)
  }
  return keys('normal', 1, 10)
}

export function checkPveStageUnlock(
  progress: Readonly<PveProgressPayload>,
  selection: PveStageSelection,
): UnlockCheckResult {
  if (!isPveStageSelection(selection)) {
    return { allowed: false, reason: '关卡或难度不存在。' }
  }
  const cleared = clearedPveStageKeys(progress)
  const missing = prerequisiteStageKeys(selection).filter(key => !cleared.has(key))
  if (missing.length === 0) return { allowed: true }

  if (selection.difficulty === 'easy') {
    return { allowed: false, reason: `请先通关第 ${selection.levelId - 1} 关简单难度。` }
  }
  if (selection.difficulty === 'normal') {
    const requiredEnd = selection.levelId <= 5 ? 5 : selection.levelId
    return { allowed: false, reason: `请先通关第 1–${requiredEnd} 关简单难度。` }
  }
  return { allowed: false, reason: '请先通关全部 10 个关卡的普通难度。' }
}

export function derivePveProgressionView(progress: Readonly<PveProgressPayload>): PveProgressionView {
  const cleared = clearedPveStageKeys(progress)
  const stages: PveStageUnlockState[] = PVE_STAGE_SELECTIONS.map(selection => {
    const stageKey = pveStageKey(selection)
    const check = checkPveStageUnlock(progress, selection)
    return {
      ...selection,
      stageKey,
      cleared: cleared.has(stageKey),
      unlocked: check.allowed,
      lockedReason: check.allowed ? null : check.reason,
      prerequisiteStageKeys: prerequisiteStageKeys(selection),
    }
  })
  return {
    schemaVersion: 1,
    clearedStageKeys: [...cleared].sort(),
    stages,
  }
}

export function stageSelectionLabel(selection: PveStageSelection): string {
  const stage = getPveStageDefinition(selection.levelId)
  return `${stage?.label ?? `PVE-${selection.levelId}`} · ${PVE_DIFFICULTY_LABELS[selection.difficulty]}`
}

/**
 * @deprecated 仅为旧 SocketGateway 编译兼容；新选关必须调用 checkPveStageUnlock。
 */
export function checkUnlock(_progress: UserProgress, targetLevel: number): UnlockCheckResult {
  return ALL_LEVEL_IDS.includes(targetLevel)
    ? { allowed: true }
    : { allowed: false, reason: `PVE 关卡 ${targetLevel} 不存在。` }
}
