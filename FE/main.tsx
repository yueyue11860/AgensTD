import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { GamingPage } from './pages/gaming-page'
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
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<TowerDefenseFrontendPage />} />
        <Route path="/room" element={<TowerDefenseFrontendPage />} />
        <Route path="/room/:roomId" element={<TowerDefenseFrontendPage />} />
        <Route path="/leaderboard" element={<TowerDefenseFrontendPage />} />
        {/* <Route path="/hot-replays" element={<TowerDefenseFrontendPage />} /> */}{/* 暂时隐藏热门回放，后续按需开启 */}
        <Route path="/skill" element={<TowerDefenseFrontendPage />} />
        <Route path="/gaming" element={<GamingPage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)