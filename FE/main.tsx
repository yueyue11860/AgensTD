import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RouteErrorBoundary, RouteLoadingFallback } from './components/route-boundary'
import { LoginPage } from './pages/login-page'
import './app/globals.css'

const RequireAuth = lazy(async () => {
  const module = await import('./components/require-auth')
  return { default: module.RequireAuth }
})
const TowerDefenseFrontendPage = lazy(async () => {
  const module = await import('./pages/tower-defense-frontend-page')
  return { default: module.TowerDefenseFrontendPage }
})
const GamingPage = lazy(async () => {
  const module = await import('./pages/gaming-page')
  return { default: module.GamingPage }
})
const MetaSystemPage = lazy(async () => {
  const module = await import('./pages/meta-system-page')
  return { default: module.MetaSystemPage }
})
const PvpPage = lazy(async () => {
  const module = await import('./pages/pvp-page')
  return { default: module.PvpPage }
})

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root was not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<TowerDefenseFrontendPage />} />
        <Route path="/leaderboard" element={<Navigate to="/pvp/leaderboard" replace />} />
        <Route path="/skill" element={<Navigate to="/pvp" replace />} />

        {/* 进入房间 / 游戏需要登录（真人玩家） */}
        <Route path="/room" element={<RequireAuth><TowerDefenseFrontendPage /></RequireAuth>} />
        <Route path="/room/:roomId" element={<RequireAuth><TowerDefenseFrontendPage /></RequireAuth>} />
        <Route path="/gaming" element={<RequireAuth><GamingPage /></RequireAuth>} />
        <Route path="/build" element={<RequireAuth><MetaSystemPage mode="build" /></RequireAuth>} />
        <Route path="/arsenal" element={<RequireAuth><MetaSystemPage mode="arsenal" /></RequireAuth>} />
        <Route path="/shop" element={<RequireAuth><MetaSystemPage mode="shop" /></RequireAuth>} />
        <Route path="/pvp" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/matchmaking" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/rooms" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/rooms/:roomId" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/game/:matchId" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/results/:matchId" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/history" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/history/:matchId" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/pvp/leaderboard" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><PvpPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
