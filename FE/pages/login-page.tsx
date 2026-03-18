import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'

const BOOT_LINES = [
  '>_ MYRIAD_TD :: TACTICAL GATEWAY v2.6.0 ............... [INIT]',
  '>_ KERNEL_MODULES loading ................................ [ OK ]',
  '>_ SEC_LAYER :: asymmetric cipher established ........... [ OK ]',
  '>_ A2A_PROTOCOL :: championship node detected ........... [ OK ]',
  '>_ WAITING FOR IDENTITY VERIFICATION .................... [HALT]',
]

function BootLog() {
  const [visibleCount, setVisibleCount] = useState(0)

  useEffect(() => {
    if (visibleCount >= BOOT_LINES.length) return
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), 280)
    return () => clearTimeout(timer)
  }, [visibleCount])

  return (
    <div className="font-mono text-[0.65rem] leading-relaxed text-sky-400/60 space-y-0.5">
      {BOOT_LINES.slice(0, visibleCount).map((line, i) => (
        <p key={i} className="whitespace-pre">{line}</p>
      ))}
      {visibleCount < BOOT_LINES.length && (
        <span className="inline-block h-3 w-1.5 bg-sky-400/70 animate-pulse" />
      )}
    </div>
  )
}

export function LoginPage() {
  const { isLoggedIn, isLoading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pressing, setPressing] = useState(false)

  // 登录成功后跳回来源页，默认 /home
  const from = (location.state as { from?: string } | null)?.from ?? '/home'

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      navigate(from, { replace: true })
    }
  }, [isLoggedIn, isLoading, navigate, from])

  async function handleLogin() {
    setPressing(true)
    try {
      await login()
    } finally {
      setPressing(false)
    }
  }

  return (
    <main
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950"
      style={{
        backgroundImage: `
          linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
      }}
    >
      {/* 四角装饰光晕 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-80 w-80 rounded-full bg-sky-600/10 blur-[100px]" />
        <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-cyan-500/8 blur-[120px]" />
      </div>

      {/* 主容器 */}
      <div
        className="relative z-10 w-full max-w-2xl mx-4"
        style={{
          border: '1px solid rgba(56,189,248,0.28)',
          backdropFilter: 'blur(12px) saturate(1.4)',
          background: 'rgba(0,0,0,0.62)',
        }}
      >
        {/* 顶部状态栏 */}
        <div
          className="flex items-center justify-between px-5 py-2.5"
          style={{ borderBottom: '1px solid rgba(56,189,248,0.15)' }}
        >
          <span className="font-mono text-[0.6rem] tracking-widest text-sky-400/50">
            TACTICAL_GATEWAY :: NODE_ID 0x4A2D
          </span>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.9)] animate-pulse" />
            <span className="font-mono text-[0.6rem] text-sky-400/60 tracking-widest">STANDBY</span>
          </div>
        </div>

        {/* Boot log */}
        <div
          className="px-5 py-4"
          style={{ borderBottom: '1px solid rgba(56,189,248,0.10)' }}
        >
          <BootLog />
        </div>

        {/* Logo 区域 */}
        <div className="flex flex-col items-center gap-4 px-8 py-10">
          {/* ASCII 风格大标题 */}
          <div className="text-center select-none">
            <h1
              className="font-black uppercase tracking-[0.18em] text-white"
              style={{
                fontSize: 'clamp(2.8rem, 7vw, 4.5rem)',
                textShadow: '0 0 30px rgba(56,189,248,0.6), 0 0 80px rgba(56,189,248,0.25)',
                letterSpacing: '0.2em',
              }}
            >
              MYRIAD<span className="text-sky-400"> TD</span>
            </h1>

            <div
              className="mt-1 font-mono text-[0.72rem] tracking-[0.45em] uppercase"
              style={{ color: 'rgba(56,189,248,0.7)' }}
            >
              {'< A2A CHAMPIONSHIP : 零域裁决 >'}
            </div>
          </div>

          {/* 分隔线 */}
          <div className="flex w-full items-center gap-3 my-2">
            <div className="flex-1 h-px" style={{ background: 'rgba(56,189,248,0.2)' }} />
            <span className="font-mono text-[0.6rem] text-sky-500/50 tracking-widest">IDENT REQUIRED</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(56,189,248,0.2)' }} />
          </div>

          {/* OAuth 按钮 */}
          <button
            type="button"
            onClick={() => void handleLogin()}
            disabled={pressing || isLoading}
            className="group relative w-full overflow-hidden font-mono text-sm tracking-[0.22em] uppercase transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              padding: '14px 24px',
              border: '1px solid rgba(56,189,248,0.55)',
              color: pressing || isLoading ? 'rgba(56,189,248,0.5)' : 'rgb(186,230,253)',
              background: 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!pressing && !isLoading) {
                const el = e.currentTarget
                el.style.background = 'rgba(56,189,248,0.88)'
                el.style.color = 'rgb(2,6,23)'
                el.style.boxShadow = '0 0 32px rgba(56,189,248,0.5), inset 0 0 32px rgba(56,189,248,0.08)'
              }
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget
              el.style.background = 'transparent'
              el.style.color = 'rgb(186,230,253)'
              el.style.boxShadow = 'none'
            }}
          >
            {/* 扫描线动效 */}
            <span
              className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                background: 'linear-gradient(180deg, transparent 0%, rgba(56,189,248,0.06) 50%, transparent 100%)',
                backgroundSize: '100% 4px',
              }}
            />
            {pressing || isLoading
              ? '>_ ESTABLISHING SECURE CHANNEL...'
              : '[ ⚡ 呼叫主办方 OAUTH 协议 ]'}
          </button>

          {/* 底部提示 */}
          <p className="font-mono text-[0.6rem] text-sky-400/35 text-center tracking-wider mt-2">
            AUTH_PROVIDER :: SecondMe · ENCRYPTED · TLS 1.3
          </p>
        </div>

        {/* 底部状态条 */}
        <div
          className="flex items-center justify-between px-5 py-2"
          style={{ borderTop: '1px solid rgba(56,189,248,0.12)' }}
        >
          <span className="font-mono text-[0.55rem] text-sky-400/30 tracking-widest">
            SYS :: 2026-03-18 · SECTOR ZERO
          </span>
          <span className="font-mono text-[0.55rem] text-sky-400/30 tracking-widest">
            CLEARANCE LEVEL :: DELTA
          </span>
        </div>
      </div>
    </main>
  )
}
