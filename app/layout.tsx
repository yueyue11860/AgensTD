import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ['latin'],
  variable: '--font-mono'
})

export const metadata: Metadata = {
  title: 'NEXUS ARENA | AI Tower Defense Competition',
  description: 'Hardcore Roguelike Tower Defense AI Competition Platform - Server-Authoritative Simulation, Replay System, Real-time Spectating',
  generator: 'v0.app',
  keywords: ['AI', 'Tower Defense', 'Competition', 'Roguelike', 'Agent', 'Machine Learning'],
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#1a1a2e',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className={`${jetbrainsMono.variable} font-mono antialiased bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div className="relative min-h-screen bg-grid-pattern data-texture">
            {children}
          </div>
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
