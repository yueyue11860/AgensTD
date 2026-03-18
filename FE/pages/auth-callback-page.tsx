import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { exchangeCode } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const processedRef = useRef(false)

  useEffect(() => {
    if (processedRef.current) return
    processedRef.current = true

    const code = searchParams.get('code')
    const errorParam = searchParams.get('error')

    if (errorParam) {
      setError(searchParams.get('error_description') ?? '授权被拒绝')
      return
    }

    if (!code) {
      setError('缺少授权码')
      return
    }

    exchangeCode(code)
      .then((ok) => {
        if (ok) {
          navigate('/home', { replace: true })
        } else {
          setError('登录失败，请重试')
        }
      })
      .catch(() => {
        setError('登录失败，请重试')
      })
  }, [searchParams, exchangeCode, navigate])

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-[#020408] text-white">
      {error ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/home', { replace: true })}
            className="rounded border border-cyan-400/40 px-6 py-2 text-sm text-cyan-300 hover:bg-cyan-400/10"
          >
            返回首页
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="text-sm text-cyan-200/80">正在登录中...</p>
        </div>
      )}
    </main>
  )
}
