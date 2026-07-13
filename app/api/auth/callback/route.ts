import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

  if (!code) return NextResponse.redirect(`${baseUrl}/?yt_error=no_code`);

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${baseUrl}/api/auth/callback`,
        grant_type: "authorization_code",
      }),
    });

    const data = await res.json();
    if (!data.access_token) throw new Error(data.error || "No token");

    const response = NextResponse.redirect(`${baseUrl}/?page=youtube&yt_ok=1`);

    // Store refresh_token in httpOnly cookie (30 days)
    if (data.refresh_token) {
      response.cookies.set("yt_refresh", data.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }
    // Store access_token in short-lived cookie (1 hour)
    response.cookies.set("yt_access", data.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: data.expires_in || 3600,
      path: "/",
    });

    return response;
  } catch (err) {
    return NextResponse.redirect(`${baseUrl}/?yt_error=${encodeURIComponent(String(err))}`);
  }
}
