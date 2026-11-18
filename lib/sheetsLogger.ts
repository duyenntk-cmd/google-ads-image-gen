import { createSign } from "crypto";

/**
 * The system spreadsheet: Users (accounts), LoginLog and UsageLog tabs.
 * Set SYSTEM_SHEET_ID to run the app against another team's sheet; the
 * fallback is this team's sheet so existing deployments keep working.
 */
export const SPREADSHEET_ID = process.env.SYSTEM_SHEET_ID || "17KwfmFYVT9DuJIC4o5aRGzGRwKkkipGBXIEl011FONs";
const LOGIN_TAB = "LoginLog";
const LOGIN_HEADER = ["Thời gian", "Email", "Tên", "IP", "User Agent", "Kết quả"];

export async function getAccessToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(sa.private_key, "base64url");
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

const colLetter = (n: number) => String.fromCharCode(64 + n); // 1 → A, fine up to Z

/** Creates the tab and its header row when missing. Safe to call before every write. */
export async function ensureTab(token: string, tab: string, header: string[]) {
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const range = `${tab}!A1:${colLetter(header.length)}1`;
  const head = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, { headers: auth });
  if (head.ok) {
    const d = await head.json();
    if (d.values?.length) return;
  } else {
    // A missing tab answers 400: create it.
    const add = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    if (!add.ok) throw new Error(`Không tạo được tab ${tab}: HTTP ${add.status}`);
  }
  const put = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`,
    { method: "PUT", headers: auth, body: JSON.stringify({ values: [header] }) },
  );
  if (!put.ok) throw new Error(`Không ghi được tiêu đề tab ${tab}: HTTP ${put.status}`);
}

/**
 * One row per sign-in attempt in the LoginLog tab. Written RAW so a crafted
 * user agent or username cannot become a formula in the sheet.
 */
export async function logLoginToSheet(params: {
  email: string;
  name: string;
  ip: string;
  userAgent: string;
  result?: string;
}) {
  try {
    const token = await getAccessToken();
    await ensureTab(token, LOGIN_TAB, LOGIN_HEADER);
    const timestamp = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const clip = (v: string, n = 300) => String(v ?? "").slice(0, n);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${LOGIN_TAB}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          values: [[timestamp, clip(params.email), clip(params.name), clip(params.ip, 60), clip(params.userAgent), clip(params.result || "ok", 40)]],
        }),
      }
    );
    if (!res.ok) throw new Error(`Sheets append HTTP ${res.status}`);
  } catch (err) {
    // Never block a sign-in on the log, but say so in the server log.
    console.error("sheetsLogger error:", err instanceof Error ? err.message : err);
  }
}
