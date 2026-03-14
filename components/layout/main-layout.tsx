'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Header } from './header'
import { primaryNavigationItems } from './navigation'
import { cn } from '@/lib/utils'

interface MainLayoutProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
}

export function MainLayout({ children, title, subtitle }: MainLayoutProps) {
  const pathname = usePathname()

  return (
    <div className="relative min-h-screen bg-grid-pattern">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-cold-blue/5 via-transparent to-warning-orange/5" />
      <div className="pointer-events-none fixed inset-0 data-texture" />

      <main className="relative min-h-screen">
        <Header title={title} subtitle={subtitle} />
        <div className="sticky top-14 z-20 border-b border-border bg-background/88 backdrop-blur-md">
          <div className="flex gap-3 overflow-x-auto px-4 py-3 lg:px-6">
            {primaryNavigationItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'min-w-[180px] rounded-xl border px-4 py-3 transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 text-primary shadow-[0_0_0_1px_rgba(101,144,247,0.2)]'
                      : 'border-border bg-card/70 text-muted-foreground hover:border-primary/30 hover:bg-muted/30 hover:text-foreground',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border',
                      isActive ? 'border-primary/30 bg-primary/10' : 'border-border bg-background/60',
                    )}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
        <div className="relative p-4 lg:p-5">
          {children}
        </div>
      </main>
    </div>
  )
}
