/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // google-play-scraper is a server-only CommonJS package; keep it out of the bundle
    serverComponentsExternalPackages: ["google-play-scraper"],
  },
};
module.exports = nextConfig;
