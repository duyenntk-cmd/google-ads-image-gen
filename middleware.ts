import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

function verifySession(cookie: string): boolean {
  const parts = cookie.split(".");
  if (parts.length < 2) return false;
  const sig = parts.pop()!;
  const email = parts.join(".");
  const secret = process.env.SESSION_SECRET || "default-secret-change-me";
  const expected = createHmac("sha256", secret).update(email).digest("hex").slice(0, 16);
  return sig === expected;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow auth routes and login page
  if (
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const session = req.cookies.get("app_session")?.value;
  if (!session || !verifySession(session)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
