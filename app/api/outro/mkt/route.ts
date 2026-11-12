import { NextRequest, NextResponse } from "next/server";
import { parseConnectCode } from "@/lib/mktClient";
import { storeConnection, clearConnection, readConnection } from "@/lib/mktSession";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Outro Studio → MKT System: the connection.
 *
 * Same connect code and same cookie (`mkt_connect`) as the creative upload on
 * the Banner + Ad Copy page, so connecting in one place connects both. The
 * code stays in an httpOnly cookie; the page only ever sees whose code it is
 * and when it expires.
 *
 * The routes are behind proxy.ts like every other /api route.
 */

/**
 * Where MKT System's web app lives, for the "Mở MKT System" link. Not a
 * secret. MKT_SYSTEM_URL (Vercel env) wins and may contain "{tag}" to open a
 * filtered list; otherwise it is guessed from the API host the connect code
 * points at, minus a leading "api." / "api-".
 */
function systemUrl(backendUrl: string): string {
  if (process.env.MKT_SYSTEM_URL) return process.env.MKT_SYSTEM_URL;
  try {
    const u = new URL(backendUrl);
    u.hostname = u.hostname.replace(/^api[.-]/, "");
    return u.origin;
  } catch {
    return "";
  }
}

const noStore = { "cache-control": "no-store" };

export async function GET() {
  const conn = await readConnection();
  if (!conn) return NextResponse.json({ connected: false }, { headers: noStore });
  return NextResponse.json(
    { connected: true, email: conn.email, expiresAt: conn.expiresAt, systemUrl: systemUrl(conn.backendUrl) },
    { headers: noStore },
  );
}

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    const conn = parseConnectCode(String(code || ""));

    // Check the code works before keeping it, so a bad code fails here and
    // not halfway through pushing a batch of videos.
    const res = await fetch(conn.backendUrl + "auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: conn.refreshToken }),
    });
    if (res.status === 401) throw new Error("Mã kết nối đã hết hạn. Lấy mã mới từ MKT System.");
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Mã kết nối không dùng được (HTTP ${res.status}). ${detail.slice(0, 200)}`);
    }

    await storeConnection(String(code).trim(), conn);
    return NextResponse.json({
      connected: true,
      email: conn.email,
      expiresAt: conn.expiresAt,
      systemUrl: systemUrl(conn.backendUrl),
    });
  } catch (err) {
    return NextResponse.json(
      { connected: false, error: (err as Error)?.message || "Không kết nối được." },
      { status: 400 },
    );
  }
}

/** Forgets the code on this web. MKT System has no revoke, so it stays valid there until it expires. */
export async function DELETE() {
  await clearConnection();
  return NextResponse.json({ connected: false });
}
