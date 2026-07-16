import { NextRequest, NextResponse } from "next/server";

async function signSession(email: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || "default-secret-change-me";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signedBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email));
  const sig = Array.from(new Uint8Array(signedBuf))
    .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `${email}.${sig}`;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

  if (!code) return NextResponse.redirect(`${baseUrl}/login?error=no_code`);

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${baseUrl}/api/auth/login/callback`,
        grant_type: "authorization_code",
      }),
    });

    const data = await res.json();
    if (!data.access_token) throw new Error("No token");

    // Get user email
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const user = await userRes.json();
    const email: string = user.email?.toLowerCase() || "";

    // Check whitelist
    const allowed = (process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (!allowed.includes(email)) {
      return NextResponse.redirect(`${baseUrl}/login?error=not_allowed&email=${encodeURIComponent(email)}`);
    }

    // Set session cookie
    const response = NextResponse.redirect(`${baseUrl}/`);
    response.cookies.set("app_session", await signSession(email), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });
    return response;
  } catch (err) {
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(String(err))}`);
  }
}
