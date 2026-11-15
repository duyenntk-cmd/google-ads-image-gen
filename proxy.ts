import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function proxy(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = req.nextUrl;

  // Allow login and auth routes through
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    // Claude connector: called by Claude's servers with the personal key in the URL, no web session
    pathname.startsWith("/api/mcp/") ||
    // Claude probes OAuth metadata when a connector is added; a plain 404 (not a redirect to /login) means "no OAuth"
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Redirect to login if not authenticated
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/auth|api/mcp/|\\.well-known/|_next/static|_next/image|favicon.ico).*)"],
};
