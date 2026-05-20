import type { NextConfig } from "next";

const isStaticExport = process.env.NEXT_STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  ...(isStaticExport && {
    output: "export",
    basePath: "/tradingview-gratis",
  }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
