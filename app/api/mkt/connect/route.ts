import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { parseConnectCode } from "@/lib/mktClient";
import { storeConnection, clearConnection, readConnection } from "@/lib/mktSession";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Current connection, for the header line the guide asks to always show. */
export async function GET() {
  const unauth = await requireSession();
  if (unauth) return unauth;
  const conn = await readConnection();
  if (!conn) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, email: conn.email, expiresAt: conn.expiresAt });
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { code } = await req.json();
    const conn = parseConnectCode(String(code || ""));

    // Verify before storing: a code that parses but cannot authenticate is
    // worse than one rejected outright, because the failure would surface
    // later, in the middle of an upload.
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
    return NextResponse.json({ connected: true, email: conn.email, expiresAt: conn.expiresAt });
  } catch (err) {
    return NextResponse.json(
      { connected: false, error: (err as Error)?.message || "Không kết nối được." },
      { status: 400 },
    );
  }
}

/**
 * Forget the code here. It stays valid on MKT System until it expires — there
 * is no revoke endpoint — and the UI says so.
 */
export async function DELETE() {
  const unauth = await requireSession();
  if (unauth) return unauth;
  await clearConnection();
  return NextResponse.json({ connected: false });
}
