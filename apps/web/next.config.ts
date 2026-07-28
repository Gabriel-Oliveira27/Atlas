import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Os packages do monorepo são TypeScript puro (sem build). O Next
  // precisa transpilá-los junto com a aplicação.
  transpilePackages: ['@atlas/shared', '@atlas/validation'],
  eslint: {
    // O lint roda no pipeline do Turborepo, não no build do Next.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
