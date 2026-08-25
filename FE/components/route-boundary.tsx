import { Component, type ReactNode } from 'react'
import { AlertTriangle, House, RefreshCw } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

export function RouteLoadingFallback() {
  return (
    <main className="route-loading-page" aria-busy="true" aria-live="polite">
      <span className="route-loading-mark" aria-hidden>箓</span>
      <strong>正在展开天庭卷宗</strong>
      <p>载入章回与机关组件…</p>
    </main>
  )
}

interface RouteErrorBoundaryInnerProps {
  children: ReactNode
  onReturnHome: () => void
}

interface RouteErrorBoundaryInnerState {
  failed: boolean
}

class RouteErrorBoundaryInner extends Component<RouteErrorBoundaryInnerProps, RouteErrorBoundaryInnerState> {
  state: RouteErrorBoundaryInnerState = { failed: false }

  static getDerivedStateFromError(): RouteErrorBoundaryInnerState {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Route rendering failed', { name: error.name })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="route-error-page" role="alert">
        <div className="route-error-panel">
          <span className="route-error-mark"><AlertTriangle aria-hidden /></span>
          <p className="route-error-eyebrow">卷宗载入中断</p>
          <h1>这一章暂时无法展开</h1>
          <p>页面组件未能正确载入。你的对局与账号数据不会在此页面补算或改写。</p>
          <div>
            <button type="button" onClick={() => window.location.reload()}><RefreshCw aria-hidden />重新载入</button>
            <button type="button" onClick={this.props.onReturnHome}><House aria-hidden />返回大厅首页</button>
          </div>
        </div>
      </main>
    )
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <RouteErrorBoundaryInner key={location.key} onReturnHome={() => navigate('/home')}>
      {children}
    </RouteErrorBoundaryInner>
  )
}
