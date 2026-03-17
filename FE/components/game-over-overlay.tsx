import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Trophy, XCircle } from 'lucide-react'
import { cx } from '../lib/cx'
import { resolveApiBaseUrl, resolveGatewayToken } from '../lib/runtime-config'
import type { ActionLogEntry } from '../hooks/use-game-engine'
import type { GameAction } from '../types/game-state'

// ─────────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────────

type UploadState = 'idle' | 'uploading' | 'done' | 'skipped' | 'error'

interface GameOverOverlayProps {
  outcome: 'victory' | 'defeat'
  /** 本局关卡 ID；仅 L5/L6 胜利时上传录像 */
  currentLevelId: number | null
  /** 本局收集的行为日志 */
  actionLog: ActionLogEntry[]
  /** 点击"返回大厅"时调用（仅清除状态，不触发录像上传） */
  onLeave: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// 录像上传
// ─────────────────────────────────────────────────────────────────────────────

async function postReplayVictory(levelId: number, actionLog: ActionLogEntry[]): Promise<boolean> {
  const apiBase = resolveApiBaseUrl()
  const token = resolveGatewayToken()
  if (!apiBase) return false

  const res = await fetch(`${apiBase}/replays`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      isVictory: true,
      level: levelId,
      replayData: {
        actions: actionLog,
        capturedAt: new Date().toISOString(),
      },
    }),
  })

  const data = await res.json()
  return Boolean(data.stored)
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

export function GameOverOverlay({ outcome, currentLevelId, actionLog, onLeave }: GameOverOverlayProps) {
  const isVictory = outcome === 'victory'
  const shouldUpload = isVictory && (currentLevelId === 5 || currentLevelId === 6)
  const [uploadState, setUploadState] = useState<UploadState>(shouldUpload ? 'uploading' : 'idle')

  useEffect(() => {
    if (!shouldUpload || currentLevelId === null) return

    postReplayVictory(currentLevelId, actionLog)
      .then((stored) => setUploadState(stored ? 'done' : 'skipped'))
      .catch(() => setUploadState('error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={cx('game-over-backdrop', isVictory ? 'game-over-backdrop-victory' : 'game-over-backdrop-defeat')}>
      <div className={cx('game-over-panel', isVictory ? 'game-over-panel-victory' : 'game-over-panel-defeat')}>

        {/* ── 图标 ──────────────────────────────────────────────────────── */}
        <div className={cx('game-over-icon-wrap', isVictory ? 'game-over-icon-victory' : 'game-over-icon-defeat')}>
          {isVictory
            ? <Trophy className="h-10 w-10" />
            : <XCircle className="h-10 w-10" />}
        </div>

        {/* ── 标题 ─────────────────────────────────────────────────────── */}
        <p className={cx('game-over-eyebrow', isVictory ? 'game-over-eyebrow-victory' : 'game-over-eyebrow-defeat')}>
          {isVictory ? 'MISSION COMPLETE' : 'NODE COMPROMISED'}
        </p>

        <h1 className={cx('game-over-title', isVictory ? 'game-over-title-victory' : 'game-over-title-defeat')}>
          {isVictory ? '任务完成' : '节点沦陷'}
        </h1>

        <p className="game-over-subtitle">
          {isVictory
            ? `Level ${currentLevelId ?? '?'} 防线稳固，抵御成功`
            : '防线被突破，返回大厅重新部署'}
        </p>

        {/* ── 录像上传状态（仅 L5/L6 胜利显示） ────────────────────────── */}
        {shouldUpload && (
          <div className={cx('game-over-upload', uploadState === 'done' && 'game-over-upload-done', uploadState === 'error' && 'game-over-upload-error')}>
            {uploadState === 'uploading' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>作战记录上传中…</span>
              </>
            )}
            {uploadState === 'done' && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>作战记录已归档至排行榜</span>
              </>
            )}
            {uploadState === 'skipped' && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>记录已提交</span>
              </>
            )}
            {uploadState === 'error' && (
              <>
                <XCircle className="h-3.5 w-3.5" />
                <span>归档失败，可稍后查阅排行榜</span>
              </>
            )}
          </div>
        )}

        {/* ── 操作按钮 ─────────────────────────────────────────────────── */}
        <div className="game-over-actions">
          <button
            type="button"
            onClick={onLeave}
            className={cx(
              'game-over-btn',
              isVictory ? 'game-over-btn-victory' : 'game-over-btn-defeat',
            )}
          >
            返回大厅
          </button>
        </div>
      </div>
    </div>
  )
}
