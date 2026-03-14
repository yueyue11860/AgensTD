'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent } from '@/components/ui/sheet'

interface MainLayoutProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
}

export function MainLayout({ children, title, subtitle }: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024)
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(true)
      }
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <div className="relative min-h-screen bg-grid-pattern">
      {/* Ambient background effects */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-cold-blue/5 via-transparent to-warning-orange/5" />
      <div className="pointer-events-none fixed inset-0 data-texture" />
      
      {!isMobile && <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />}

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-72 border-r border-border bg-sidebar p-0 sm:max-w-none">
          <Sidebar mobile onNavigate={() => setMobileSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <main
        className={cn(
          'relative min-h-screen transition-all duration-300',
          !isMobile && (sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'),
          'ml-0'
        )}
      >
        <Header title={title} subtitle={subtitle} showMenuButton={isMobile} onMenuClick={() => setMobileSidebarOpen(true)} />
        <div className="relative p-4 lg:p-5">
          {children}
        </div>
      </main>
    </div>
  )
}
