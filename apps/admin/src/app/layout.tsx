import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { APP_NAME } from '@atlas/shared';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: `${APP_NAME} — painel administrativo`,
  description: 'Administração de academias, catálogo de exercícios, sincronização e workflows.',
};

export const viewport: Viewport = {
  themeColor: '#0B1120',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
