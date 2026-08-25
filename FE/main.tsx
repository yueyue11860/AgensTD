import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/require-auth'
import { AuthCallbackPage } from './pages/auth-callback-page'
import { GamingPage } from './pages/gaming-page'
import { LoginPage } from './pages/login-page'
import { MetaSystemPage } from './pages/meta-system-page'
import { PvpPage } from './pages/pvp-page'
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
    </BrowserRouter>
  </StrictMode>,
)
