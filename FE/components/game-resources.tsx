import { memo, type ComponentType } from 'react'
import { Coins, Flame, ShieldAlert, Sparkles, TriangleAlert, Wrench } from 'lucide-react'
import { cx } from '../lib/cx'
import type { ResourceState } from '../types/game-state'

interface ResourceMetricProps {
  label: string
  value: number
  icon: ComponentType<{ className?: string }>
  tone: string
  max?: number
  note?: string
}

function ResourceMetric({ label, value, icon: Icon, tone, max, note }: ResourceMetricProps) {
  const ratio = max ? Math.min(value / max, 1) : 1

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cx('flex h-10 w-10 items-center justify-center rounded-xl border border-current/20 bg-current/10', tone)}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</p>
            <p className={cx('mt-1 text-xl font-semibold', tone)}>{value.toLocaleString()}{max ? <span className="ml-1 text-sm text-slate-400">/ {max}</span> : null}</p>
          </div>
        </div>
        {max ? <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">{Math.round(ratio * 100)}%</span> : null}
      </div>
      {max ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className={cx('h-full rounded-full transition-all', tone.replace('text-', 'bg-'))} style={{ width: `${ratio * 100}%` }} />
        </div>
      ) : null}
      {note ? <p className="mt-3 text-xs leading-5 text-slate-400">{note}</p> : null}
    </article>
  )
}

interface GameResourcesProps {
  resources: ResourceState
}

export const GameResources = memo(function GameResources({ resources }: GameResourcesProps) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <ResourceMetric label="金币" value={resources.gold} icon={Coins} tone="text-yellow-400" note="仅展示服务端当前余额。" />
      <ResourceMetric label="法力" value={resources.mana} max={resources.manaLimit} icon={Sparkles} tone="text-cold-blue" note="所有数值以 TICK_UPDATE 为准。" />
      <ResourceMetric label="热量" value={resources.heat} max={resources.heatLimit} icon={Flame} tone="text-warning-orange" note="前端不再自行推导热量变化。" />
      <ResourceMetric label="维修" value={resources.repair} icon={Wrench} tone="text-cyan-300" note="维护点消耗由后端引擎裁定。" />
      <ResourceMetric label="主堡" value={resources.fortress} max={resources.fortressMax} icon={ShieldAlert} tone="text-alert-red" note="主堡损伤完全来自服务端权威结果。" />
    </section>
  )
}, (previousProps, nextProps) => {
  const previous = previousProps.resources
  const next = nextProps.resources

  return previous.gold === next.gold
    && previous.mana === next.mana
    && previous.manaLimit === next.manaLimit
    && previous.heat === next.heat
    && previous.heatLimit === next.heatLimit
    && previous.repair === next.repair
    && previous.threat === next.threat
    && previous.fortress === next.fortress
    && previous.fortressMax === next.fortressMax
})

interface ThreatCardProps {
  value: number
}

export const ThreatCard = memo(function ThreatCard({ value }: ThreatCardProps) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">威胁压强</p>
          <p className="mt-2 text-2xl font-semibold text-warning-orange">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-warning-orange/20 bg-warning-orange/10 text-warning-orange">
          <TriangleAlert className="h-5 w-5" />
        </div>
      </div>
    </article>
  )
})