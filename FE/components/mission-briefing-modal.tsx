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
// 子组件：单个关卡卡片
// ─────────────────────────────────────────────────────────────────────────────

function LevelCard({
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
        'mission-level-card',
        unlocked && !isDanger && 'mission-level-card-active',
        unlocked && isDanger && 'mission-level-card-danger',
        !unlocked && 'mission-level-card-locked',
        isDanger && 'col-span-full',
      )}
    >
      {/* 关卡编号徽章 */}
      <span className={cx('mission-level-badge', isDanger && 'mission-level-badge-danger')}>
        {isHidden ? '???' : `L${def.levelId}`}
      </span>

      {/* 关卡主标题 */}
      <p className={cx('mission-level-title', isDanger && 'mission-level-title-danger')}>
        {def.label}
      </p>

      {/* 副标题 */}
      <p className="mission-level-subtitle">{def.subtitle}</p>

      {/* 预计生存率 */}
      <div className={cx('mission-level-rate', isDanger && 'mission-level-rate-danger')}>
        <span className="mission-level-rate-label">预计生存率</span>
        <strong className="mission-level-rate-value">{formatClearRate(def.clearRate)}</strong>
      </div>

      {/* 多人提示 */}
      {def.minPlayers > 1 && (
        <div className="mission-level-coop">
          <Users className="h-3 w-3" />
          <span>强制 {def.minPlayers} 人协同</span>
        </div>
      )}

      {/* 锁定状态覆层 */}
      {!unlocked && (
        <div className="mission-level-lock-overlay">
          <Lock className="h-5 w-5" />
          <span>{def.levelId === 0 ? '仅碳基终端' : def.levelId === 6 ? `L5 通关 ${L6_UNLOCK_THRESHOLD} 次解锁` : '通关前一关解锁'}</span>
        </div>
      )}

      {/* L6 危险闪烁层 */}
      {isDanger && unlocked && (
        <div className="mission-level-danger-badge">
          <Zap className="h-3.5 w-3.5" />
          <span>零域裁决 · 极度危险</span>
        </div>
      )}
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
        {/* ── 头部 ─────────────────────────────────────────────────────── */}
        <div className="mission-briefing-header">
          <p className="mission-briefing-eyebrow">MISSION BRIEFING</p>
          <h2 className="mission-briefing-title">
            {isHost ? '选择目标战场' : '等待作战令'}
          </h2>
          <p className="mission-briefing-desc">
            {isHost
              ? '指定本轮交战协议难度等级。通关上一级即可解锁新战场。'
              : '战场等待房主下发目标指令…'}
          </p>
        </div>

        {/* ── 错误提示 ─────────────────────────────────────────────────── */}
        {engineError && (
          <div className="mission-briefing-error">
            <span className="mission-briefing-error-code">SYS_ERR</span>
            {engineError}
          </div>
        )}

        {/* ── 房主：关卡选择网格 ───────────────────────────────────────── */}
        {isHost && (
          <div className="mission-level-grid">
            {LEVEL_DEFS.map((def) => {
              const unlocked = resolveUnlock(def, progress, playerKind)
              return (
                <LevelCard
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

        {/* ── 非房主：呼吸等待文字 ─────────────────────────────────────── */}
        {!isHost && (
          <div className="mission-waiting-zone">
            <p className="mission-waiting-text">
              <span className="mission-waiting-cursor">&gt;_ </span>
              等待主机 (Host) 覆写交战协议...
            </p>
            <p className="mission-waiting-hint">房主正在选择目标难度等级，请保持待命</p>
          </div>
        )}
      </div>
    </div>
  )
}
