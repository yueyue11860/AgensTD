'use client'

import { Header } from './header'

interface MainLayoutProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
}

export function MainLayout({ children, title, subtitle }: MainLayoutProps) {
  return (
    <div className="relative min-h-screen bg-grid-pattern">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-cold-blue/5 via-transparent to-warning-orange/5" />
      <div className="pointer-events-none fixed inset-0 data-texture" />

      <main className="relative min-h-screen">
        <Header title={title} subtitle={subtitle} />
        <div className="relative p-4 lg:p-5">
          {children}
        </div>
      </main>
    </div>
  )
}
