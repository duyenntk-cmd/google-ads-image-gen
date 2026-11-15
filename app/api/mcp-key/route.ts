import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { mcpKeyFor } from "@/lib/mcpKey";

export const runtime = "nodejs";

/** The signed-in user's personal Claude connector URL (see app/api/mcp/[key]). */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user?.email || session?.user?.name;
  if (!user) return NextResponse.json({ success: false, error: "Chưa đăng nhập." }, { status: 401 });
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  return NextResponse.json(
    { success: true, url: `${origin}/api/mcp/${mcpKeyFor(user)}` },
    { headers: { "cache-control": "no-store" } },
  );
}
