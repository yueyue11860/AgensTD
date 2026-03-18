import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          <span className="font-mono text-xs text-sky-400/50 tracking-widest">VERIFYING SESSION...</span>
        </div>
      </main>
    )
  }

  if (!isLoggedIn) {
    // 把来源路径存进 state，登录后可跳回
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
