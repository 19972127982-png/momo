import type { Metadata, Viewport } from 'next'
import { SITE } from '@/lib/site'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} · ${SITE.tagline}`,
    template: `%s · ${SITE.name}`
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ['桌宠', '桌面宠物', '陪伴', 'AI 伙伴', 'EchoPet', 'Live2D', '虚拟陪伴'],
  authors: [{ name: SITE.name }],
  openGraph: {
    type: 'website',
    title: `${SITE.name} · ${SITE.tagline}`,
    description: SITE.description,
    siteName: SITE.name,
    locale: 'zh_CN',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: SITE.name }]
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} · ${SITE.tagline}`,
    description: SITE.description,
    images: ['/og.png']
  },
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png'
  }
}

export const viewport: Viewport = {
  themeColor: '#fffdfb',
  width: 'device-width',
  initialScale: 1
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
