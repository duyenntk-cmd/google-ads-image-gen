import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Return current access token or refresh it
  const accessToken = req.cookies.get("yt_access")?.value;
  if (accessToken) return NextResponse.json({ access_token: accessToken });

  const refreshToken = req.cookies.get("yt_refresh")?.value;
  if (!refreshToken) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (!data.access_token) return NextResponse.json({ error: "refresh_failed" }, { status: 401 });

    const response = NextResponse.json({ access_token: data.access_token });
    response.cookies.set("yt_access", data.access_token, {
      httpOnly: true, secure: true, sameSite: "lax",
      maxAge: data.expires_in || 3600, path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "refresh_error" }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("yt_access");
  response.cookies.delete("yt_refresh");
  return response;
}
