import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { can, CAPABILITY_LABEL, type Capability } from "@/lib/roles";

/**
 * Per-route auth check, layered behind proxy.ts.
 *
 * proxy.ts (Next 16's renamed middleware) is the primary gate and it works. This
 * is defence in depth for two specific reasons:
 *
 * 1. Its matcher excludes /api/auth/* so NextAuth can function, which leaves the
 *    hand-written routes under that prefix — /api/auth/token, /api/auth/google —
 *    with no gate at all. /api/auth/token hands back a Google access token.
 * 2. The gate is one file and one filename. Renaming or misconfiguring it opens
 *    every route at once, with no failing test to catch it, and the routes here
 *    spend money on every call.
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

/**
 * requireSession plus a role check (Role column of the Users sheet, see lib/roles.ts).
 * Use it instead of requireSession on routes that spend real budget or read revenue.
 *
 * @returns 401 when unauthenticated, 403 when the role lacks the capability, or null to continue.
 */
export async function requireCapability(cap: Capability): Promise<NextResponse | null> {
  let role: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return requireSession();
    role = session.role;
  } catch {
    return requireSession();
  }
  if (can(role, cap)) return null;
  return NextResponse.json(
    { success: false, error: `Tài khoản của bạn không có quyền ${CAPABILITY_LABEL[cap]}. Nhờ admin đổi cột Role trong sheet Users.` },
    { status: 403 },
  );
}
