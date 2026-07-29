import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { APP_NAME } from '@atlas/shared';
import { Providers } from './providers';
import { ServiceWorkerRegistrar } from '@/components/service-worker';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: `${APP_NAME} — treinos e evolução`,
  description:
    'Plataforma de gerenciamento de treinos, evolução física, hidratação e administração de academias.',
  manifest: '/manifest.webmanifest',
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  // Sem indexação: o produto é todo atrás de login.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0B1120',
  width: 'device-width',
  initialScale: 1,
  // O app tem alvos de toque grandes por design; travar o zoom
  // prejudicaria quem precisa ampliar para ler.
  maximumScale: 5,
  // Ocupa a área sob o recorte do aparelho — as barras usam `pb-safe`.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
