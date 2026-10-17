import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  serverExternalPackages: ["pg"],
  experimental: { proxyClientMaxBodySize: "65mb" },
};
export default config;
