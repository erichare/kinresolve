import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./db/migrations/001_initial.sql"]
  },
  typedRoutes: false,
  experimental: {
    proxyClientMaxBodySize: "64mb"
  }
};

export default nextConfig;
