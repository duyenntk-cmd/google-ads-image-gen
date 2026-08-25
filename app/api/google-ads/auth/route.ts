import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { refreshAccessToken } from "@/lib/googleAdsClient";

export async function GET(req: NextRequest) {
  const action = new URL(req.url).searchParams.get("action");

  if (action === "connect") {
    const redirectUri = `${process.env.NEXTAUTH_URL || "https://google-ads-image-gen.vercel.app"}/api/auth/google-ads/callback`;
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/adwords",
      access_type: "offline",
      prompt: "consent",
    });
    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  if (action === "disconnect") {
    const cookieStore = await cookies();
    cookieStore.delete("google_ads_tokens");
    return NextResponse.json({ success: true });
  }

  if (action === "status") {
    const cookieStore = await cookies();
    const raw = cookieStore.get("google_ads_tokens")?.value;
    if (!raw) return NextResponse.json({ connected: false });
    try {
      const tokens = JSON.parse(raw);
      // Try refresh if expired
      if (Date.now() > tokens.expiry - 60000) {
        const newToken = await refreshAccessToken(tokens.refresh_token);
        tokens.access_token = newToken;
        tokens.expiry = Date.now() + 3500 * 1000;
        cookieStore.set("google_ads_tokens", JSON.stringify(tokens), {
          httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/",
        });
      }
      return NextResponse.json({ connected: true });
    } catch {
      return NextResponse.json({ connected: false });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
