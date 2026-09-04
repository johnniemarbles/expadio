import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@expadio/postgres-runtime', '@expadio/tenancy', '@expadio/lead-capture'],
  typescript: { ignoreBuildErrors: false },
  async rewrites() {
    return [
      // /enquire-{slug} → /enquire/{slug} so a single-offering brand gets /enquire
      // while a multi-offering brand gets /enquire-su, /enquire-mu etc.
      { source: '/enquire-:slug', destination: '/enquire/:slug' },
    ];
  },
};

export default nextConfig;
