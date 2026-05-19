import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/tradingview-gratis",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
