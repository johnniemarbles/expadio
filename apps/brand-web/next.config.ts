import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@expadio/tenancy'],
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
