import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/require-auth'
import { AuthCallbackPage } from './pages/auth-callback-page'
import { GamingPage } from './pages/gaming-page'
import { LoginPage } from './pages/login-page'
import { TowerDefenseFrontendPage } from './pages/tower-defense-frontend-page'
import './app/globals.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root was not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<TowerDefenseFrontendPage />} />
        <Route path="/leaderboard" element={<TowerDefenseFrontendPage />} />
        <Route path="/skill" element={<TowerDefenseFrontendPage />} />

        {/* 进入房间 / 游戏需要登录（真人玩家） */}
        <Route path="/room" element={<RequireAuth><TowerDefenseFrontendPage /></RequireAuth>} />
        <Route path="/room/:roomId" element={<RequireAuth><TowerDefenseFrontendPage /></RequireAuth>} />
        <Route path="/gaming" element={<RequireAuth><GamingPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)