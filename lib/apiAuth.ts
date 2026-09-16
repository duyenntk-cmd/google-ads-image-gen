import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";

/**
 * Per-route auth check, layered behind middleware.ts.
 *
 * middleware.ts is the primary gate, but it is a single point of failure: when it
 * was renamed to proxy.ts under Next 14 it silently stopped loading and every
 * route went public for weeks. Routes that spend money (OpenAI / Ideogram image
 * generation) or reach a connected ad account re-check here so a gate failure
 * costs nothing.
 *
 * Note that /api/auth/* is excluded from the middleware matcher so NextAuth can
 * work, which means custom routes living under that prefix have NO middleware
 * protection at all and depend on this check entirely.
 *
 * Usage, as the first statement of a handler:
 *   const unauth = await requireSession();
 *   if (unauth) return unauth;
 *
 * @returns a 401 response when unauthenticated, or null to continue.
 */
export async function requireSession(): Promise<NextResponse | null> {
  try {
    const session = await getServerSession(authOptions);
    if (session?.user) return null;
  } catch {
    // Treat a broken session lookup as unauthenticated rather than open.
  }
  return NextResponse.json(
    { success: false, error: "Chưa đăng nhập. Vui lòng đăng nhập lại." },
    { status: 401 },
  );
}
