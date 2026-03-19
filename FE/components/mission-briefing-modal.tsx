import { useEffect, useState } from 'react'
import { Lock, Users, Zap } from 'lucide-react'
import { cx } from '../lib/cx'
import { LEVEL_DEFS, L6_UNLOCK_THRESHOLD, type LevelDef } from '../lib/level-defs'
import { resolveApiBaseUrl, resolveGatewayToken, resolvePlayerId } from '../lib/runtime-config'

// ─────────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────────

interface UserProgressSnapshot {
  highestUnlockedLevel: number
  level5ClearCount: number
}

interface MissionBriefingModalProps {
  /** 是否为房主（mySlot === 'P1'） */
  isHost: boolean
  /** 玩家类型，影响 L0 可用性 */
  playerKind: 'human' | 'agent'
  /** 点击合法关卡后的回调，由父组件负责发送 select_level 指令 */
  onSelectLevel: (levelId: number) => void
  /** 来自后端的错误消息（如 LEVEL_LOCKED、COOP_REQUIRED） */
  engineError: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function formatClearRate(rate: number) {
  if (rate >= 1) return '100%'
  return `${Math.round(rate * 100)}%`
}

async function fetchProgress(playerId: string): Promise<UserProgressSnapshot | null> {
  const apiBase = resolveApiBaseUrl()
  const token = resolveGatewayToken()
  if (!apiBase) return null

  try {
    const res = await fetch(`${apiBase}/progress/${encodeURIComponent(playerId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (res.status === 404) {
      // 没有进度记录 → 默认 Level 1 已解锁
      return { highestUnlockedLevel: 1, level5ClearCount: 0 }
    }
    const data = await res.json()
    if (data.ok && data.progress) {
      return {
        highestUnlockedLevel: data.progress.highestUnlockedLevel,
        level5ClearCount: data.progress.level5ClearCount,
      }
    }
  }
  catch {
    // 网络错误时回退默认值
  }
  return { highestUnlockedLevel: 1, level5ClearCount: 0 }
}

function resolveUnlock(def: LevelDef, progress: UserProgressSnapshot | null, playerKind: 'human' | 'agent'): boolean {
  if (def.levelId === 0) return playerKind === 'human'
  if (def.levelId === 6) return (progress?.level5ClearCount ?? 0) >= L6_UNLOCK_THRESHOLD
  if (def.levelId >= 1 && def.levelId <= 5) {
    return def.levelId <= (progress?.highestUnlockedLevel ?? 1)
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：单个关卡行
// ─────────────────────────────────────────────────────────────────────────────

function LevelRow({
  def,
  unlocked,
  onClick,
}: {
  def: LevelDef
  unlocked: boolean
  onClick: () => void
}) {
  const isDanger = def.danger
  const isHidden = def.hidden

  return (
    <button
      type="button"
      disabled={!unlocked}
      onClick={onClick}
      className={cx(
        'mission-level-row',
        unlocked && !isDanger && 'mission-level-row-active',
        unlocked && isDanger && 'mission-level-row-danger',
        !unlocked && 'mission-level-row-locked',
      )}
    >
      {/* 关卡编号 */}
      <span className={cx('mission-level-badge', isDanger && 'mission-level-badge-danger')}>
        {isHidden ? '???' : `L${def.levelId}`}
      </span>

      {/* 名称 + 副标题 */}
      <span className="mission-row-info">
        <span className={cx('mission-row-name', isDanger && 'mission-level-title-danger')}>
          {def.label}
        </span>
        <span className="mission-row-sub">{def.subtitle}</span>
      </span>

      {/* 右侧状态 */}
      <span className="mission-row-right">
        {!unlocked ? (
          <>
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span className="mission-row-lock-hint">
              {def.levelId === 0 ? '仅玩家' : def.levelId === 6 ? `L5×${L6_UNLOCK_THRESHOLD}` : '通关解锁'}
            </span>
          </>
        ) : (
          <>
            {def.minPlayers > 1 && <Users className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
            {isDanger && <Zap className="h-3.5 w-3.5 shrink-0 text-red-400" />}
            <span className={cx('mission-row-rate', isDanger && 'mission-row-rate-danger')}>
              {formatClearRate(def.clearRate)}
            </span>
          </>
        )}
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

export function MissionBriefingModal({ isHost, playerKind, onSelectLevel, engineError }: MissionBriefingModalProps) {
  const [progress, setProgress] = useState<UserProgressSnapshot | null>(null)
  const myPlayerId = resolvePlayerId()

  useEffect(() => {
    if (!isHost || !myPlayerId) return
    fetchProgress(myPlayerId).then(setProgress)
  }, [isHost, myPlayerId])

  return (
    <div className="mission-briefing-backdrop">
      <div className="mission-briefing-panel">
        {/* 标题行 */}
        <div className="mission-briefing-header">
          <p className="mission-briefing-eyebrow">SELECT DIFFICULTY</p>
          <h2 className="mission-briefing-title">
            {isHost ? '选择难度' : '等待房主选择难度'}
          </h2>
        </div>

        {/* 错误提示 */}
        {engineError && (
          <div className="mission-briefing-error">
            <span className="mission-briefing-error-code">ERR</span>
            {engineError}
          </div>
        )}

        {/* 房主：纵向关卡列表 */}
        {isHost && (
          <div className="mission-level-list">
            {LEVEL_DEFS.map((def) => {
              const unlocked = resolveUnlock(def, progress, playerKind)
              return (
                <LevelRow
                  key={def.levelId}
                  def={def}
                  unlocked={unlocked}
                  onClick={() => {
                    if (unlocked) onSelectLevel(def.levelId)
                  }}
                />
              )
            })}
          </div>
        )}

        {/* 非房主：等待提示 */}
        {!isHost && (
          <p className="mission-waiting-hint mt-3">
            <span className="mission-waiting-cursor">&gt;_ </span>
            等待房主选择难度…
          </p>
        )}
      </div>
    </div>
  )
}
