import type { ReactNode } from 'react'

interface FrontendShellProps {
  children: ReactNode
}

export function FrontendShell({ children }: FrontendShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-grid-pattern text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(53,125,255,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,147,41,0.14),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 data-texture opacity-70" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-5 lg:px-6 lg:py-6">
        <header className="rounded-3xl border border-white/10 bg-black/25 px-5 py-5 backdrop-blur-md">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-cold-blue">万字天关 · 天庭卷</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white lg:text-4xl">同道集结，守住西游章回</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">落字成阵，召神将破敌潮；花果山的灯火正等你点亮。</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              南天门已开，战旗可立。
            </div>
          </div>
        </header>

        <div className="mt-5 flex-1">{children}</div>
      </div>
    </main>
  )
}
