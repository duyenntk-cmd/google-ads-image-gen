export { default } from "next-auth/middleware";

/**
 * ⚠️ FILENAME IS LOAD-BEARING.
 *
 * This project runs Next.js 14 (see package.json). Next 14 discovers its request
 * gate ONLY at `middleware.ts` in the repo root or `src/` — the loader constant
 * is MIDDLEWARE_LOCATION_REGEXP = /(?:src\/)?middleware/.
 *
 * This file was once renamed to `proxy.ts` for a newer Next convention while the
 * project stayed pinned to 14.2.35. Next 14 does not look for `proxy.ts`, so the
 * file became dead code, `middleware-manifest.json` was emitted empty, and every
 * route — the whole app plus every /api endpoint — was served to anonymous users.
 *
 * Do not rename this file without first upgrading Next and confirming that
 * `.next/server/middleware-manifest.json` still lists an entry after a build.
 */
export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /login (login page)
     * - /api/auth/* (NextAuth routes + the Google Ads OAuth callback, which
     *   lands on /api/auth/google-ads/callback)
     * - /_next/* (Next.js internals)
     * - /favicon.ico, /public assets
     */
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
