import { NextRequest, NextResponse } from "next/server";
import { createSign } from "crypto";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Reads one tab of a Google Sheet for campaign analysis, with the service
 * account the app already uses for its own sheets. The sheet has to be shared
 * with that account; when it is not, the error names the address to share with.
 */
async function serviceToken(): Promise<{ token: string; email: string }> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Server thiếu GOOGLE_SERVICE_ACCOUNT_JSON.");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Không lấy được token service account.");
  return { token: data.access_token, email: sa.client_email };
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { url } = await req.json();
    const id = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
    if (!id) return NextResponse.json({ success: false, error: "Link Google Sheets không hợp lệ." }, { status: 400 });
    const gid = String(url).match(/[#&?]gid=(\d+)/)?.[1];

    const { token, email } = await serviceToken();
    const auth = { Authorization: `Bearer ${token}` };
    const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties(sheetId,title)`, { headers: auth });
    if (meta.status === 403 || meta.status === 404) {
      return NextResponse.json({ success: false, error: `Không đọc được file. Hãy share file (quyền xem) cho: ${email}` }, { status: 403 });
    }
    if (!meta.ok) throw new Error(`Sheets API HTTP ${meta.status}`);
    const m = await meta.json() as { properties: { title: string }; sheets: { properties: { sheetId: number; title: string } }[] };
    const tab = m.sheets.find(s => gid !== undefined && String(s.properties.sheetId) === gid) || m.sheets[0];
    if (!tab) throw new Error("File không có sheet nào.");

    const range = encodeURIComponent(`'${tab.properties.title.replace(/'/g, "''")}'`);
    // Unformatted, so numbers come back as numbers whatever the sheet's locale.
    const vals = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`, { headers: auth });
    if (!vals.ok) throw new Error(`Sheets API HTTP ${vals.status}`);
    const v = await vals.json() as { values?: unknown[][] };
    return NextResponse.json({ success: true, title: m.properties.title, sheet: tab.properties.title, rows: v.values || [] });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
