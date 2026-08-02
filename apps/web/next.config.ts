import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  images: { unoptimized: true },
  typedRoutes: true,
};

export default nextConfig;
