import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BookOpenText, Coins, Crown, Gauge, Hammer, LoaderCircle, RefreshCw,
  RotateCcw, ShieldCheck, SkipForward, Sparkles, Swords, Trophy, XCircle,
} from 'lucide-react'
import { cx } from '../lib/cx'
import { resolveApiBaseUrl, resolveGatewayToken } from '../lib/runtime-config'
import { useModalFocus } from '../hooks/use-modal-focus'
import {
  isRecord, normalizeSettlement, settlementLastError, settlementPayloadStatus,
  type MatchSettlement, type RevealStage, type SettlementRewardDetail,
} from './game-over-settlement'

interface GameOverOverlayProps {
  outcome: 'victory' | 'defeat'
  currentLevelId: number | null
  matchId: string | null
  onReplay: () => void
  onAdjustBuild: () => void
  onLeave: () => void
}

type SettlementView =
  | { status: 'pending'; message: string }
  | { status: 'committed'; settlement: MatchSettlement }
  | { status: 'error'; message: string; lastError?: string }

const sourceLabels: Record<string, string> = {
  match_tier: '对局档位', wave_milestone: '波次里程碑', boss_fragment_bonus: 'Boss 额外掉落',
  hard_victory_guarantee: '困难胜利保证', stage_first_clear: '章回首通',
}
const rarityLabels: Record<string, string> = { standard: '常规', green: '翠', blue: '玄', purple: '紫', orange: '金', red: '朱' }
const metricLabels = { damage: '伤害', control: '控制', rescues: '救场', kills: '击杀' } as const

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

/** Legacy records contain authoritative totals but predate source-level detail. */
function legacyRewards(settlement: MatchSettlement): SettlementRewardDetail[] {
  return [
    ...(settlement.goldGranted > 0 ? [{ kind: 'gold' as const, rewardId: `${settlement.settlementId}:gold`, label: '功勋金', amount: settlement.goldGranted, source: 'match_tier', rarity: 'standard' }] : []),
    ...Object.entries(settlement.retainedWeaponFragments).map(([weaponId, amount]) => ({ kind: 'weapon_fragment' as const, rewardId: `${settlement.settlementId}:${weaponId}`, label: weaponId, amount, source: 'wave_milestone', rarity: 'standard' })),
    ...(settlement.entitlementIds.length > 0 ? [{ kind: 'purchase_right' as const, rewardId: `${settlement.settlementId}:rights`, label: '局外商店购买权', amount: settlement.entitlementIds.length, source: 'match_tier', rarity: 'standard' }] : []),
  ]
}

export function GameOverOverlay({ outcome, currentLevelId, matchId, onReplay, onAdjustBuild, onLeave }: GameOverOverlayProps) {
  const apiBase = useMemo(() => resolveApiBaseUrl(), [])
  const token = useMemo(() => resolveGatewayToken(), [])
  const [retryKey, setRetryKey] = useState(0)
  const [settlementView, setSettlementView] = useState<SettlementView>({ status: 'pending', message: '正在等待服务端确认本局奖励…' })
  const [revealStage, setRevealStage] = useState<RevealStage>('verdict')
  const reducedMotion = useReducedMotion()
  const dialogRef = useModalFocus(onLeave)

  useEffect(() => {
    if (!matchId) { setSettlementView({ status: 'error', message: '本局缺少 matchId，无法查询权威结算。' }); return }
    if (!apiBase) { setSettlementView({ status: 'error', message: '未配置 API 地址，暂时无法读取结算。' }); return }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null
    setSettlementView({ status: 'pending', message: '正在等待服务端确认本局奖励…' })
    const maxAttempts = 20
    const pollSettlement = async (attempt: number) => {
      controller = new AbortController()
      try {
        const response = await fetch(`${apiBase}/settlements/${encodeURIComponent(matchId)}`, {
          headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: controller.signal,
        })
        const payload = await response.json().catch(() => null) as unknown
        if (stopped) return
        if (response.ok) {
          const payloadStatus = settlementPayloadStatus(payload)
          if (payloadStatus === 'pending') {
            if (attempt >= maxAttempts) throw new Error('结算提交超时，请重试查询。')
            setSettlementView({ status: 'pending', message: `奖励入账中 · 已确认 ${attempt} 次` })
            timer = setTimeout(() => void pollSettlement(attempt + 1), 1_250); return
          }
          if (payloadStatus === 'failed') {
            const lastError = settlementLastError(payload)
            setSettlementView({ status: 'error', message: '服务端本次奖励提交失败，请重试查询。', ...(lastError ? { lastError } : {}) }); return
          }
          if (payloadStatus === 'committed') {
            const settlement = normalizeSettlement(payload)
            if (!settlement) throw new Error('服务端已确认结算，但奖励明细不可识别。')
            setSettlementView({ status: 'committed', settlement }); return
          }
          throw new Error('服务端返回了不可识别的结算状态。')
        }
        if (response.status === 404 && attempt < maxAttempts) {
          setSettlementView({ status: 'pending', message: `奖励入账中 · 已确认 ${attempt} 次` })
          timer = setTimeout(() => void pollSettlement(attempt + 1), 1_250); return
        }
        const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`
        throw new Error(response.status === 404 ? '结算提交超时，请重试查询。' : `结算查询失败：${code}`)
      }
      catch (error) {
        if (stopped || (error instanceof DOMException && error.name === 'AbortError')) return
        setSettlementView({ status: 'error', message: error instanceof Error ? error.message : '结算查询失败，请稍后重试。' })
      }
    }
    void pollSettlement(1)
    return () => { stopped = true; controller?.abort(); if (timer) clearTimeout(timer) }
  }, [apiBase, matchId, retryKey, token])

  useEffect(() => {
    if (settlementView.status !== 'committed') return
    if (reducedMotion) { setRevealStage('actions'); return }
    setRevealStage('verdict')
    const timers = [setTimeout(() => setRevealStage('story'), 650), setTimeout(() => setRevealStage('rewards'), 1_450), setTimeout(() => setRevealStage('actions'), 2_250)]
    return () => timers.forEach(clearTimeout)
  }, [reducedMotion, settlementView.status])

  const settlement = settlementView.status === 'committed' ? settlementView.settlement : null
  const detail = settlement?.detail ?? null
  const isVictory = detail ? detail.outcome.victory : outcome === 'victory'
  const rewards = settlement ? (detail ? detail.rewards : legacyRewards(settlement)) : []
  const stageIndex = ['verdict', 'story', 'rewards', 'actions'].indexOf(revealStage)
  const liveText = settlementView.status === 'committed'
    ? revealStage === 'verdict' ? (isVictory ? '胜利，结算已确认' : '本局结束，结算已确认')
      : revealStage === 'story' ? '本局故事已展开' : revealStage === 'rewards' ? '奖励明细已展开' : '可选择下一步'
    : settlementView.message

  return (
    <div className={cx('game-over-backdrop', isVictory ? 'game-over-backdrop-victory' : 'game-over-backdrop-defeat')}>
      <div ref={dialogRef} className={cx('game-over-panel', isVictory ? 'game-over-panel-victory' : 'game-over-panel-defeat')}
        role="dialog" aria-modal="true" aria-labelledby="game-over-title" aria-describedby="game-over-summary" tabIndex={-1}>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{liveText}</p>
        <div className="game-over-heading">
          <div className={cx('game-over-icon-wrap', isVictory ? 'game-over-icon-victory' : 'game-over-icon-defeat')}>
            {isVictory ? <Trophy className="h-8 w-8" /> : <XCircle className="h-8 w-8" />}
          </div>
          <div><p className={cx('game-over-eyebrow', isVictory ? 'game-over-eyebrow-victory' : 'game-over-eyebrow-defeat')}>{settlement ? '服务端已落签' : '等待结算'}</p>
            <h1 id="game-over-title" className={cx('game-over-title', isVictory ? 'game-over-title-victory' : 'game-over-title-defeat')}>{isVictory ? '守关已成' : '此回暂终'}</h1>
            <p id="game-over-summary" className="game-over-subtitle">{detail?.story.title ?? (isVictory ? `PVE-${currentLevelId ?? '?'} 防线稳固` : '调整构筑后可再战此回')}</p></div>
          {settlement && revealStage !== 'actions' ? <button type="button" className="game-over-skip" onClick={() => setRevealStage('actions')}><SkipForward className="h-4 w-4" />跳过揭晓</button> : null}
        </div>

        {settlementView.status === 'pending' ? <section className="game-over-settlement game-over-settlement-pending" aria-live="polite"><LoaderCircle className="game-over-spinner h-5 w-5" /><div><strong>权威结算处理中</strong><p>{settlementView.message}</p></div></section> : null}
        {settlementView.status === 'error' ? <section className="game-over-settlement game-over-settlement-error" role="alert"><AlertTriangle className="h-5 w-5" /><div><strong>奖励状态暂不可用</strong><p>{settlementView.message} 对局结果不会在客户端补算。</p>{settlementView.lastError ? <small className="game-over-last-error">服务端记录：{settlementView.lastError}</small> : null}</div><button type="button" onClick={() => setRetryKey(key => key + 1)}><RefreshCw className="h-4 w-4" />重试</button></section> : null}

        {settlement ? <div className="game-over-reveal" data-stage={revealStage}>
          <section className="game-over-verdict"><span>{detail?.outcome.reason ?? settlement.reason}</span><strong>{settlement.highestCompletedWave} / {detail?.outcome.maxWaves || 20} 波</strong><small>{detail ? `规则 ${detail.rules.combatRulesetVersion} · 奖励 ${detail.rules.rewardTableRevision}` : '旧版结算记录'}</small></section>

          {stageIndex >= 1 ? <section className="game-over-story game-over-reveal-section">
            <header><BookOpenText className="h-4 w-4" /><strong>本局故事</strong></header>
            <p>{detail?.story.summary ?? `最高完成第 ${settlement.highestCompletedWave} 波，结算已持久化。`}</p>
            {detail?.story.failureSuggestion ? <aside><ShieldCheck className="h-4 w-4" /><span><b>下一局可执行建议</b>{detail.story.failureSuggestion}</span></aside> : null}
            {detail ? <div className="game-over-performance">
              {detail.performance.damageDealt !== null ? <span><Swords />伤害 <b>{detail.performance.damageDealt.toLocaleString()}</b></span> : null}
              {detail.performance.kills !== null ? <span><Trophy />击杀 <b>{detail.performance.kills}</b></span> : null}
              {detail.performance.controlAppliedMs !== null ? <span><Gauge />控制 <b>{(detail.performance.controlAppliedMs / 1000).toFixed(1)}s</b></span> : null}
              {detail.performance.rescues !== null ? <span><ShieldCheck />救场 <b>{detail.performance.rescues}</b></span> : null}
            </div> : null}
            {detail?.lineup.coreGeneral || detail?.lineup.activeSynergies.length ? <div className="game-over-lineup">
              {detail.lineup.coreGeneral ? <span><Crown />核心神将 <b>{detail.lineup.coreGeneral.name} · Lv.{detail.lineup.coreGeneral.level}</b></span> : null}
              {detail.lineup.activeSynergies.map(synergy => <span key={synergy.synergyId}><Sparkles />{synergy.name} <b>{synergy.level} 阶</b></span>)}
            </div> : null}
            {detail?.mvp ? <div className="game-over-mvp"><Crown className="h-5 w-5" /><div><strong>本局 MVP · {detail.mvp.playerId}</strong><small>综合评分 {(detail.mvp.scoreBps / 100).toFixed(1)} · 击杀权重仅 5%</small><p>{detail.mvp.basis.map(item => `${metricLabels[item.metric]} ${item.value} × ${item.weightBps / 100}%`).join(' · ')}</p></div></div> : null}
            {detail?.performance.coverage === 'partial' ? <small className="game-over-coverage">本局缺少完整权威事件覆盖，因此不展示战绩数值与 MVP。</small> : null}
          </section> : null}

          {stageIndex >= 2 ? <section className="game-over-rewards game-over-reveal-section">
            <header><Sparkles className="h-4 w-4" /><strong>奖励揭晓</strong><small>已入账</small></header>
            {rewards.length > 0 ? <div className="game-over-reward-list">{rewards.map(reward => <article key={reward.rewardId} className={`game-over-reward game-over-rarity-${reward.rarity}`}>
              {reward.kind === 'gold' ? <Coins /> : reward.kind === 'purchase_right' ? <Hammer /> : reward.kind === 'first_clear' ? <Trophy /> : <Sparkles />}
              <div><strong>{reward.label}</strong><small>{sourceLabels[reward.source] ?? reward.source}{reward.milestoneWave ? ` · 第 ${reward.milestoneWave} 波` : ''}</small></div><span className="game-over-rarity">{rarityLabels[reward.rarity] ?? reward.rarity}</span><b>+{reward.amount}</b>
            </article>)}</div> : <div className="game-over-zero-reward"><ShieldCheck /><span><strong>本局无额外奖励</strong><small>服务端返回的奖励列表为空，未在客户端补算。</small></span></div>}
          </section> : null}
        </div> : null}

        <p className="game-over-authority-note">奖励、首通与 MVP 完全以服务端持久记录为准 · {matchId ? `MATCH ${matchId}` : 'MATCH ID 缺失'}</p>
        <div className={cx('game-over-actions', revealStage === 'actions' && 'game-over-actions-revealed')}>
          <button type="button" onClick={onReplay} className={cx('game-over-btn game-over-btn-primary', isVictory ? 'game-over-btn-victory' : 'game-over-btn-defeat')}><RotateCcw className="h-4 w-4" />再来一局</button>
          <button type="button" onClick={onAdjustBuild} className="game-over-btn game-over-btn-secondary"><Hammer className="h-4 w-4" />调整构筑</button>
          <button type="button" onClick={onLeave} className="game-over-btn game-over-btn-quiet">返回大厅</button>
        </div>
      </div>
    </div>
  )
}
