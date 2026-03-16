import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GamingPage } from './pages/gaming-page'
import { TowerDefenseFrontendPage } from './pages/tower-defense-frontend-page'
import './app/globals.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root was not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    {window.location.pathname.replace(/\/+$/, '') === '/gaming' ? <GamingPage /> : <TowerDefenseFrontendPage />}
  </StrictMode>,
)