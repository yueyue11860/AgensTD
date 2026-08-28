import { FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'

const BOOT_LINES = [
  '>_ MYRIAD_TD :: TACTICAL GATEWAY v2.6.0 ............... [INIT]',
  '>_ KERNEL_MODULES loading ................................ [ OK ]',
  '>_ SEC_LAYER :: asymmetric cipher established ........... [ OK ]',
  '>_ SUPABASE_AUTH :: identity service online ............. [ OK ]',
  '>_ WAITING FOR IDENTITY VERIFICATION .................... [HALT]',
]

function BootLog() {
  const [visibleCount, setVisibleCount] = useState(0)
  useEffect(() => {
    if (visibleCount >= BOOT_LINES.length) return
    const timer = setTimeout(() => setVisibleCount((count) => count + 1), 220)
    return () => clearTimeout(timer)
  }, [visibleCount])

  return (
    <div className="min-w-0 max-w-full space-y-0.5 overflow-hidden font-mono text-[0.65rem] leading-relaxed text-sky-400/60">
      {BOOT_LINES.slice(0, visibleCount).map((line) => <p key={line} className="whitespace-pre-wrap break-all">{line}</p>)}
      {visibleCount < BOOT_LINES.length && <span className="inline-block h-3 w-1.5 animate-pulse bg-sky-400/70" />}
    </div>
  )
}

export function LoginPage() {
  const { isLoggedIn, isLoading, error: sessionError, localTestAccount, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const from = (location.state as { from?: string } | null)?.from ?? '/home'

  useEffect(() => {
    if (!isLoading && isLoggedIn) navigate(from, { replace: true })
  }, [from, isLoggedIn, isLoading, navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)
    setMessage(null)
    try {
      const result = mode === 'login'
        ? await login(email, password)
        : await register(name, email, password)
      if (!result.ok) {
        setFormError(result.error ?? '身份验证失败，请重试')
      } else if (result.needsEmailConfirmation) {
        setMessage('注册成功。请打开验证邮件完成账号激活。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || isLoading
  const inputClass = 'w-full border border-sky-400/25 bg-slate-950/80 px-4 py-3 font-mono text-sm text-sky-100 outline-none transition focus:border-sky-400/70 focus:shadow-[0_0_18px_rgba(56,189,248,0.12)]'

  return (
    <main
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950"
      style={{
        backgroundImage: 'linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-80 w-80 rounded-full bg-sky-600/10 blur-[100px]" />
        <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-4 w-full max-w-2xl border border-sky-400/30 bg-black/65 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-sky-400/15 px-5 py-2.5">
          <span className="font-mono text-[0.6rem] tracking-widest text-sky-400/50">TACTICAL_GATEWAY :: SUPABASE NODE</span>
          <span className="font-mono text-[0.6rem] tracking-widest text-emerald-400/70">● ONLINE</span>
        </div>

        <div className="border-b border-sky-400/10 px-5 py-4"><BootLog /></div>

        <div className="flex flex-col items-center gap-5 px-6 py-8 sm:px-10">
          <div className="select-none text-center">
            <h1 className="text-4xl font-black uppercase tracking-[0.18em] text-white sm:text-6xl" style={{ textShadow: '0 0 30px rgba(56,189,248,0.6)' }}>
              MYRIAD<span className="text-sky-400"> TD</span>
            </h1>
            <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.35em] text-sky-400/70">{'< 零域身份终端 >'}</p>
          </div>

          <div className="grid w-full grid-cols-2 border border-sky-400/20 p-1 font-mono text-xs tracking-widest">
            {(['login', 'register'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => { setMode(entry); setFormError(null); setMessage(null) }}
                className={`px-4 py-2.5 transition ${mode === entry ? 'bg-sky-400 text-slate-950' : 'text-sky-300/60 hover:bg-sky-400/10'}`}
              >
                {entry === 'login' ? '登录' : '创建账号'}
              </button>
            ))}
          </div>

          <form className="w-full space-y-3" onSubmit={(event) => void handleSubmit(event)}>
            {mode === 'login' && localTestAccount && (
              <div className="border border-amber-300/25 bg-amber-950/20 px-3 py-2.5 font-mono text-xs text-amber-100/80">
                <div className="flex items-center justify-between gap-3">
                  <span>本地测试账号（无需数据库）</span>
                  <button
                    type="button"
                    className="border border-amber-300/30 px-2 py-1 text-[0.65rem] text-amber-200 transition hover:bg-amber-300/10"
                    onClick={() => { setEmail(localTestAccount.email); setPassword(localTestAccount.password) }}
                  >
                    一键填入
                  </button>
                </div>
                <p className="mt-1 text-[0.65rem] text-amber-100/55">{localTestAccount.email} / {localTestAccount.password}</p>
              </div>
            )}
            {mode === 'register' && (
              <label className="block">
                <span className="mb-1.5 block font-mono text-[0.62rem] tracking-widest text-sky-400/55">CALLSIGN / 玩家代号</span>
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" maxLength={40} required placeholder="输入玩家代号" />
              </label>
            )}
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.62rem] tracking-widest text-sky-400/55">EMAIL / 邮箱</span>
              <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="commander@example.com" />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.62rem] tracking-widest text-sky-400/55">PASSWORD / 密码</span>
              <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required placeholder="至少 6 位" />
            </label>

            {(formError || sessionError) && <p role="alert" className="border border-red-400/25 bg-red-950/30 px-3 py-2 font-mono text-xs text-red-300">{formError ?? sessionError}</p>}
            {message && <p role="status" className="border border-emerald-400/25 bg-emerald-950/30 px-3 py-2 font-mono text-xs text-emerald-300">{message}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full border border-sky-400/60 px-6 py-3.5 font-mono text-sm uppercase tracking-[0.2em] text-sky-100 transition hover:bg-sky-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '>_ VERIFYING IDENTITY...' : mode === 'login' ? '[ 进入战区 ]' : '[ 建立作战档案 ]'}
            </button>
          </form>

          <p className="font-mono text-[0.6rem] tracking-wider text-sky-400/35">AUTH_PROVIDER :: SUPABASE AUTH · JWT · TLS 1.3</p>
        </div>

        <div className="flex items-center justify-between border-t border-sky-400/10 px-5 py-2 font-mono text-[0.55rem] tracking-widest text-sky-400/30">
          <span>SYS :: SECTOR ZERO</span><span>CLEARANCE :: DELTA</span>
        </div>
      </div>
    </main>
  )
}
