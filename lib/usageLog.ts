import { getAccessToken, SPREADSHEET_ID } from "@/lib/sheetsLogger";

/**
 * Usage log: one row per finished action, in the "UsageLog" tab of the same
 * spreadsheet as the login history (already shared with the service account).
 * It is the evidence for "used for real, how often, what it saved". The tab
 * and its header are created on first use.
 */
export const USAGE_TAB = "UsageLog";
export const USAGE_HEADER = [
  "Thời gian", "Ngày", "Email", "Công cụ", "Hành động", "App",
  "Thị trường", "Số ảnh", "Số template", "Thời gian chạy (giây)", "Kết quả", "Ghi chú", "Version",
];

export interface UsageEvent {
  tool: string;
  action: string;
  app?: string;
  markets?: string;
  images?: number;
  templates?: number;
  durationSec?: number;
  result?: "ok" | "partial" | "error";
  note?: string;
}

const clip = (v: unknown, n = 300) => String(v ?? "").slice(0, n);

async function ensureTab(token: string) {
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const head = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USAGE_TAB}!A1:M1`,
    { headers: auth },
  );
  if (head.ok) {
    const d = await head.json();
    if (d.values?.length) return;
  } else {
    // Missing tab answers 400; create it.
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: USAGE_TAB } } }] }),
    });
  }
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USAGE_TAB}!A1:M1?valueInputOption=RAW`,
    { method: "PUT", headers: auth, body: JSON.stringify({ values: [USAGE_HEADER] }) },
  );
}

export async function logUsage(email: string, ev: UsageEvent, version: string) {
  const token = await getAccessToken();
  await ensureTab(token);
  const now = new Date();
  const time = now.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const row = [
    time, day, clip(email), clip(ev.tool, 60), clip(ev.action, 80), clip(ev.app, 120),
    clip(ev.markets, 200), Number(ev.images) || 0, Number(ev.templates) || 0,
    Math.round(Number(ev.durationSec) || 0), clip(ev.result || "ok", 10), clip(ev.note, 500), version,
  ];
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USAGE_TAB}!A:M:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) },
  );
  if (!res.ok) throw new Error(`Sheets append HTTP ${res.status}`);
}
