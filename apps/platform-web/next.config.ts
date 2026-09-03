import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ['@expadio/lead-capture', '@expadio/lead-identity']
};

export default nextConfig;
