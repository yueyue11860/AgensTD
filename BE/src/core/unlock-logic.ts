import type { UserProgress, UnlockCheckResult } from '../domain/progress'
import { ALL_LEVEL_IDS } from '../config/level-config'

/**
 * 新版 PVE 当前按场景选关，已废弃旧版教学/难度/隐藏关解锁规则。
 * 场景解锁与局外进度将在关卡专项确定后重新接入。
 */
export function checkUnlock(_progress: UserProgress, targetLevel: number): UnlockCheckResult {
  return ALL_LEVEL_IDS.includes(targetLevel)
    ? { allowed: true }
    : { allowed: false, reason: `PVE 关卡 ${targetLevel} 不存在。` }
}
