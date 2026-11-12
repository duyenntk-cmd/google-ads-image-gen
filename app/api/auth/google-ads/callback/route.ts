import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/?google_ads_error=access_denied", req.url));
  }

  const redirectUri = `${process.env.NEXTAUTH_URL || "https://google-ads-image-gen.vercel.app"}/api/auth/google-ads/callback`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await res.json();
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/?google_ads_error=no_refresh_token", req.url));
  }

  // Store tokens in a secure httpOnly cookie (session-level)
  const cookieStore = await cookies();
  cookieStore.set("google_ads_tokens", JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry: Date.now() + tokens.expires_in * 1000,
  }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return NextResponse.redirect(new URL("/?google_ads_connected=1", req.url));
}
