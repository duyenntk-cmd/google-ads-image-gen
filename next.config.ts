import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  async rewrites() {
    // Outro Studio là trang tĩnh trong public/outro-studio
    return [{ source: "/outro-studio", destination: "/outro-studio/index.html" }];
  },
};

export default nextConfig;
