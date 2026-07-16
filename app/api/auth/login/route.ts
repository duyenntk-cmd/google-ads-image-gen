import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${baseUrl}/api/auth/login/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(url.toString());
}
