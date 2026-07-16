import { NextRequest, NextResponse } from "next/server";

async function verifySession(cookie: string): Promise<boolean> {
  const parts = cookie.split(".");
  if (parts.length < 2) return false;
  const sig = parts.pop()!;
  const email = parts.join(".");
  const secret = process.env.SESSION_SECRET || "default-secret-change-me";

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signedBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email));
  const expected = Array.from(new Uint8Array(signedBuf))
    .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return sig === expected;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const session = req.cookies.get("app_session")?.value;
  if (!session || !(await verifySession(session))) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
