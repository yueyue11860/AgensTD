import { ArrowUpRight, Cpu, Hammer, RadioTower, Send, Sparkles } from 'lucide-react'
import { cx } from '../lib/cx'
import type { ActionDescriptor, GameAction, GameCell, GameState, GridPosition, TowerState } from '../types/game-state'

interface GameSidebarProps {
  gameState: GameState | null
  selectedCell: GridPosition | null
  selectedCellData: GameCell | null
  selectedTower: TowerState | null
  selectedBuildType: string | null
  lastSentAction: GameAction | null
  onSelectBuildType: (type: string | null) => void
  onAction: (action: GameAction) => void
}

function ActionButton({ descriptor, onAction }: { descriptor: ActionDescriptor; onAction: (action: GameAction) => void }) {
  return (
    <button
      type="button"
      disabled={descriptor.disabled}
      onClick={() => onAction(descriptor.payload)}
      className={cx(
        'w-full rounded-2xl border px-4 py-3 text-left transition-all',
        descriptor.disabled
          ? 'cursor-not-allowed border-white/10 bg-white/[0.03] opacity-60'
          : 'border-cold-blue/25 bg-cold-blue/10 hover:border-cold-blue/40 hover:bg-cold-blue/15',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{descriptor.label}</p>
          {descriptor.description ? <p className="mt-1 text-xs leading-5 text-slate-400">{descriptor.description}</p> : null}
        </div>
        <ArrowUpRight className="mt-0.5 h-4 w-4 text-cold-blue" />
      </div>
      {descriptor.reason ? <p className="mt-2 text-[11px] text-slate-500">{descriptor.reason}</p> : null}
    </button>
  )
}

export function GameSidebar({
  gameState,
  selectedCell,
  selectedCellData,
  selectedTower,
  selectedBuildType,
  lastSentAction,
  onSelectBuildType,
  onAction,
}: GameSidebarProps) {
  return (
    <aside className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">建造面板</p>
            <h2 className="mt-2 text-lg font-semibold text-white">选择建筑类型</h2>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cold-blue/20 bg-cold-blue/10 text-cold-blue">
            <Hammer className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {gameState?.buildPalette.length ? gameState.buildPalette.map((blueprint) => (
            <button
              key={blueprint.type}
              type="button"
              disabled={blueprint.disabled}
              onClick={() => onSelectBuildType(selectedBuildType === blueprint.type ? null : blueprint.type)}
              className={cx(
                'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                blueprint.disabled
                  ? 'cursor-not-allowed border-white/10 bg-white/[0.03] opacity-60'
                  : 'border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]',
                selectedBuildType === blueprint.type && 'border-acid-green/35 bg-acid-green/10',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">{blueprint.label}</p>
                  {blueprint.description ? <p className="mt-1 text-xs leading-5 text-slate-400">{blueprint.description}</p> : null}
                </div>
                {blueprint.costLabel ? <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">{blueprint.costLabel}</span> : null}
              </div>
              {blueprint.reason ? <p className="mt-2 text-[11px] text-slate-500">{blueprint.reason}</p> : null}
            </button>
          )) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
              尚未收到服务端 buildPalette，等待首个 tick_update。
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          {selectedBuildType
            ? `当前建造模式：${selectedBuildType}。点击地图上的 build 格会发送 BUILD_TOWER 指令。`
            : '未启用建造模式。先选择一种塔，再点击 build 格发送建造指令。'}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">焦点信息</p>
            <h2 className="mt-2 text-lg font-semibold text-white">选中对象</h2>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white">
            <RadioTower className="h-5 w-5" />
          </div>
        </div>

        {selectedTower ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm font-medium text-white">{selectedTower.name}</p>
              <p className="mt-1 text-xs text-slate-400">{selectedTower.type} · Lv.{selectedTower.level}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">范围 {selectedTower.range ?? '-'}</div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">伤害 {selectedTower.damage ?? '-'}</div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">攻速 {selectedTower.attackRate ?? '-'}</div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">状态 {selectedTower.status}</div>
              </div>
            </div>

            {selectedTower.commands?.length ? (
              <div className="space-y-2">
                {selectedTower.commands.map((descriptor) => (
                  <ActionButton key={descriptor.id} descriptor={descriptor} onAction={onAction} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-4 text-sm text-slate-400">
                该建筑当前没有服务端下发的可执行命令。
              </div>
            )}
          </div>
        ) : selectedCell ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
            <p className="font-medium text-white">地块 ({selectedCell.x}, {selectedCell.y})</p>
            <p className="mt-2 text-slate-400">类型：{selectedCellData?.kind ?? 'unknown'}</p>
            <p className="mt-2 text-slate-400">点击 build 格时，如果已选择塔类型，前端会立即发送 BUILD_TOWER 动作，但画面仍等待服务端回流更新。</p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
            先在地图上选择一个地块或建筑。
          </div>
        )}
      </section>

      {gameState?.actionBar?.actions.length ? (
        <section className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">服务端建议动作</p>
              <h2 className="mt-2 text-lg font-semibold text-white">{gameState.actionBar.title ?? '操作列表'}</h2>
              {gameState.actionBar.summary ? <p className="mt-2 text-sm text-slate-400">{gameState.actionBar.summary}</p> : null}
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cold-blue/20 bg-cold-blue/10 text-cold-blue">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {gameState.actionBar.actions.map((descriptor) => (
              <ActionButton key={descriptor.id} descriptor={descriptor} onAction={onAction} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-cold-blue">最近上报</p>
            <h2 className="mt-2 text-lg font-semibold text-white">最后一次 send_action</h2>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white">
            <Send className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          {lastSentAction ? (
            <pre className="overflow-auto whitespace-pre-wrap break-all text-xs leading-6 text-slate-300">{JSON.stringify(lastSentAction, null, 2)}</pre>
          ) : (
            <p className="text-sm text-slate-400">当前会话还没有发送任何动作。</p>
          )}
        </div>

        {gameState?.notices?.length ? (
          <div className="mt-4 space-y-2">
            {gameState.notices.map((notice) => (
              <div key={notice} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-cold-blue" />
                  {notice}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </aside>
  )
}