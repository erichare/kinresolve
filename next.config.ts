import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: false,
  experimental: {
    proxyClientMaxBodySize: "64mb"
  }
};

export default nextConfig;
