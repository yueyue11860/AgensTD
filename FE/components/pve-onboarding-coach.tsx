import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import type { PveOnboardingFacts, PveOnboardingStepId } from '../game/onboarding/pve-onboarding'

interface CoachCopy {
  anchor: string
  eyebrow: string
  title: string
  body: string
  note: string
}

function copyForStep(step: PveOnboardingStepId, facts: PveOnboardingFacts): CoachCopy {
  if (step === 'recruit') return {
    anchor: 'recruit', eyebrow: '第一步 · 斋饭与召唤', title: '先看斋饭，再落召唤令',
    body: `首次召唤从 5 斋饭起；此刻服务端确认的费用是 ${facts.nextRecruitCost} 斋饭。费用变化始终以按钮为准。`,
    note: '召唤只发送请求，不会在客户端先扣资源。',
  }
  if (step === 'select-tray') return {
    anchor: 'tray', eyebrow: '第二步 · 选择托盘', title: '点一个已有字灵',
    body: '托盘刷新后，选择任意已有单位。蓝色天兵占人口；神将字符不占人口。',
    note: '也可以拖拽；键盘用户可 Tab 到托盘后按 Enter。',
  }
  if (step === 'deploy') return {
    anchor: 'battlefield', eyebrow: '第三步 · 合法部署', title: '把选择落到可部署格',
    body: '选择后点击战场的可部署格。路线与核心格不会接受部署，服务器确认后棋盘才会更新。',
    note: '方向键移动格游标，Enter 或空格确认，Escape 取消。',
  }
  if (step === 'merge') return {
    anchor: 'tray', eyebrow: '第四步 · 同字同级合成', title: facts.mergeAvailable ? '阵中已有可合成的一对' : '记住合成方向，不必等字池',
    body: facts.mergeAvailable
      ? '把同兵种、同等级的两名天兵叠到一起，服务器会生成更高一级单位。'
      : '只有同兵种、同等级天兵才能合成。当前权威字池没有成对单位，这一步不会阻止你继续守关。',
    note: '不承诺本轮召唤必定出现相同单位。',
  }
  if (step === 'general') return {
    anchor: 'synergy', eyebrow: '第五步 · 神将配方', title: facts.generalFormed ? '神将已成，可认识固定' : '相邻字符按配方显圣',
    body: facts.generalFormed
      ? '选中成将字符，在详情中可固定神将；固定后组合整体迁移，解除后才能拆分。'
      : '把正确神将字符按配方相邻摆放即可成将。召唤不保证出现指定字，当前没有配方时继续守关即可。',
    note: '神将与羁绊都以服务器 formation 状态为准。',
  }
  return {
    anchor: 'boss', eyebrow: '第六步 · 首领预警', title: 'Boss 信号优先于普通提示',
    body: `当前第 ${facts.currentWave} 波。首领登场或读条时，顶部会显示名称、阶段、生命与技能倒计时。`,
    note: '预警来自服务器事件；可跳过提示，先完成当前战术动作。',
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function coachPosition(anchor: Element | null): { card: CSSProperties, marker: CSSProperties } {
  if (!anchor || typeof window === 'undefined') return {
    card: { left: 12, top: 90, width: 320 }, marker: { display: 'none' },
  }
  const rect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const gap = 12
  const width = Math.min(340, viewportWidth - 16)
  const estimatedHeight = viewportWidth < 600 ? 204 : 190
  let left = rect.right + gap
  let top = rect.top
  if (viewportWidth < 600) {
    left = 8
    top = rect.bottom + gap + estimatedHeight <= viewportHeight
      ? rect.bottom + gap
      : rect.top - estimatedHeight - gap
  }
  else if (left + width > viewportWidth - 8) {
    if (rect.left - width - gap >= 8) left = rect.left - width - gap
    else {
      left = clamp(rect.left, 8, viewportWidth - width - 8)
      top = rect.bottom + gap + estimatedHeight <= viewportHeight ? rect.bottom + gap : rect.top - estimatedHeight - gap
    }
  }
  return {
    card: {
      width,
      left: clamp(left, 8, viewportWidth - width - 8),
      top: clamp(top, 8, Math.max(8, viewportHeight - estimatedHeight - 8)),
    },
    marker: {
      left: clamp(rect.left - 5, 2, viewportWidth - 4),
      top: clamp(rect.top - 5, 2, viewportHeight - 4),
      width: Math.max(8, Math.min(viewportWidth - rect.left - 2, rect.width + 10)),
      height: Math.max(8, Math.min(viewportHeight - rect.top - 2, rect.height + 10)),
    },
  }
}

export function PveOnboardingCoach({
  step,
  facts,
  visible,
  paused,
  onSkipStep,
  onSkipAll,
  onPause,
  onResume,
}: {
  step: PveOnboardingStepId | null
  facts: PveOnboardingFacts | null
  visible: boolean
  paused: boolean
  onSkipStep: () => void
  onSkipAll: () => void
  onPause: () => void
  onResume: () => void
}) {
  const copy = useMemo(() => step && facts ? copyForStep(step, facts) : null, [facts, step])
  const [position, setPosition] = useState(() => coachPosition(null))

  useLayoutEffect(() => {
    if (!visible || !copy) return
    const selector = `[data-onboarding-anchor~="${copy.anchor}"]`
    const update = () => setPosition(coachPosition(document.querySelector(selector)))
    update()
    const anchor = document.querySelector(selector)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (anchor) observer?.observe(anchor)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [copy, visible])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onPause()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onPause, visible])

  if (paused && facts?.running) {
    return <button type="button" className="pve-onboarding-resume" onClick={onResume} aria-label="恢复首局提示">恢复首局提示</button>
  }
  if (!visible || !copy || !step) return null

  return (
    <div className="pve-onboarding-layer" data-step={step}>
      <span className="pve-onboarding-marker" style={position.marker} aria-hidden />
      <aside className="pve-onboarding-coach" style={position.card} role="region" aria-labelledby="pve-onboarding-title">
        <p className="pve-onboarding-eyebrow">{copy.eyebrow}</p>
        <h2 id="pve-onboarding-title">{copy.title}</h2>
        <span className="pve-onboarding-state" role="status" aria-live="polite">{paused ? '教学提示已暂停' : '教学中 · 可跳过'}</span>
        <p>{copy.body}</p>
        <small>{copy.note}</small>
        <div className="pve-onboarding-actions">
          <button type="button" onClick={onSkipStep}>跳过此步</button>
          <button type="button" onClick={onPause}>稍后</button>
          <button type="button" onClick={onSkipAll}>全部跳过</button>
        </div>
      </aside>
      <span className="sr-only" aria-live="polite">首局提示：{copy.title}</span>
    </div>
  )
}
