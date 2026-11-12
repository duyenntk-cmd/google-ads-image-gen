import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  // Shown in the sidebar and written to every usage-log row, so a row says
  // which version produced it. See CHANGELOG.md.
  env: { APP_VERSION: pkg.version },
  async rewrites() {
    // Outro Studio là trang tĩnh trong public/outro-studio
    return [{ source: "/outro-studio", destination: "/outro-studio/index.html" }];
  },
};

export default nextConfig;
