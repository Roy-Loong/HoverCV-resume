import type { NextConfig } from "next";
const config: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  devIndicators: false,
  serverExternalPackages: ["pg"],
  experimental: { proxyClientMaxBodySize: "65mb" },
};
export default config;
