import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  // Shown in the sidebar and written to every usage-log row, so a row says
  // which version produced it. See CHANGELOG.md.
  env: { APP_VERSION: pkg.version },
};

export default nextConfig;
