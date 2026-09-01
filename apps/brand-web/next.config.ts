import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@expadio/postgres-runtime', '@expadio/tenancy'],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
