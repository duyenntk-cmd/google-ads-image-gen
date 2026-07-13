import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  const redirectUri = `${baseUrl}/api/auth/callback`;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return NextResponse.redirect(url.toString());
}
