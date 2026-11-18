#!/usr/bin/env node
/**
 * MKT System intraday report → Discord.
 *
 * For each product: Spend and ROAS (all countries), CPI and LTV (US only),
 * each compared with the run closest to 24 hours earlier, i.e. the same hour
 * yesterday. Runs on a GitHub Actions schedule (.github/workflows/mkt-report.yml);
 * no npm install needed.
 *
 * Data comes from the same API the Intraday page of MKT System uses
 * (report/marketing-report/intraday/*), signed in with the user's connect code.
 *
 * The repo is PUBLIC, and so are its Actions logs. Nothing below logs a
 * metric: numbers go only to the Discord webhook, and the snapshots kept for
 * tomorrow's comparison are AES-256-GCM encrypted before they touch the cache.
 *
 * Env:
 *   MKT_CONNECT_CODE     mktmcp_… (MKT System > Profile > Kết nối Claude). Valid ~24 h.
 *   DISCORD_WEBHOOK_URL  webhook of the personal Discord channel
 *   PRODUCTS             product codes, comma separated
 *   MODE                 send (default) | debug (posts the data's shape to Discord) |
 *                        dry (prints the Discord payload to stdout — local use only)
 *   REVENUE_FIELD        revenue column for ROAS / LTV (default sum_metric_est_cohort_revenue_d0)
 *   STATE_FILE           encrypted snapshot history (default .mkt-report-state/snapshots.enc)
 *   SNAPSHOT_KEY         optional; key for the snapshot file (default derived from the webhook URL)
 *   SCHEDULE_UTC_HOURS   hours the workflow runs, for the code-expiry warning (default 0,7,13)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const env = process.env;
const MODE = (env.MODE || process.argv[2] || "send").trim().toLowerCase();
const PRODUCTS = (env.PRODUCTS || "AAP861,APL789,AAP887,AIP016,AAP883")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const REVENUE_FIELD = (env.REVENUE_FIELD || "sum_metric_est_cohort_revenue_d0").trim();
const STATE_FILE = env.STATE_FILE || ".mkt-report-state/snapshots.enc";
// Accept the URL pasted with Discord's <…> link wrapping still on it.
const WEBHOOK = (env.DISCORD_WEBHOOK_URL || "").trim().replace(/^<|>$/g, "");
const SCHEDULE_UTC_HOURS = (env.SCHEDULE_UTC_HOURS || "0,7,13").split(",").map(Number).filter((n) => n >= 0 && n < 24);

const VN_OFFSET = 7 * 3600_000; // Asia/Ho_Chi_Minh, no DST
const DAY = 24 * 3600_000;
const COMPARE_WINDOW = 3 * 3600_000; // a "yesterday" snapshot must be within ±3 h of now − 24 h
const KEEP_HISTORY = 4 * DAY;

const INTRADAY = "report/marketing-report/intraday/";
const US = new Set(["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"]);

const log = (...a) => console.log("[mkt-report]", ...a);

/* ─────────────────────────── time (Vietnam) ─────────────────────────── */

function vn(d = new Date()) {
  const v = new Date(d.getTime() + VN_OFFSET);
  return { y: v.getUTCFullYear(), mo: v.getUTCMonth() + 1, d: v.getUTCDate(), h: v.getUTCHours(), mi: v.getUTCMinutes() };
}
const p2 = (n) => String(n).padStart(2, "0");
const hhmm = (d) => { const t = vn(d); return `${p2(t.h)}:${p2(t.mi)}`; };
const ddmm = (d) => { const t = vn(d); return `${p2(t.d)}/${p2(t.mo)}`; };

/** End of the Vietnam calendar day, as the Intraday page sends it (moment().endOf("d").toISOString() in a VN browser). */
function endOfVnDay(d = new Date()) {
  const t = vn(d);
  return new Date(Date.UTC(t.y, t.mo - 1, t.d, 23, 59, 59, 999) - VN_OFFSET).toISOString();
}

function nextScheduledRun(now = new Date()) {
  const hours = SCHEDULE_UTC_HOURS.length ? [...SCHEDULE_UTC_HOURS].sort((a, b) => a - b) : [0];
  for (let add = 0; add < 2; add++) {
    for (const h of hours) {
      const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, h);
      if (t > now.getTime() + 30 * 60_000) return new Date(t);
    }
  }
  return new Date(now.getTime() + DAY);
}

/* ─────────────────────────── MKT System API ─────────────────────────── */

class UserFacingError extends Error {}

function b64url(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function parseConnectCode(raw) {
  const code = (raw || "").trim();
  if (!code) throw new UserFacingError("Chưa có mã kết nối MKT (secret `MKT_CONNECT_CODE`).");
  if (!code.startsWith("mktmcp_")) throw new UserFacingError("`MKT_CONNECT_CODE` không phải mã kết nối MKT (phải bắt đầu bằng `mktmcp_`).");
  let data;
  try { data = JSON.parse(b64url(code.slice(7))); } catch { throw new UserFacingError("Mã kết nối MKT bị hỏng, copy lại từ MKT System."); }
  if (data.v !== 1 || !data.backendUrl || !data.refreshToken) throw new UserFacingError("Mã kết nối MKT không đúng định dạng.");
  const payload = JSON.parse(b64url(data.refreshToken.split(".")[1] || "") || "{}");
  return {
    backendUrl: data.backendUrl.replace(/\/?$/, "/"),
    refreshToken: data.refreshToken,
    email: payload.user?.email || "",
    expiresAt: (payload.exp || 0) * 1000,
  };
}

async function mktClient(conn) {
  if (Date.now() >= conn.expiresAt) {
    throw new UserFacingError(`Mã kết nối MKT đã hết hạn lúc ${hhmm(new Date(conn.expiresAt))} ${ddmm(new Date(conn.expiresAt))}.`);
  }
  const res = await fetch(conn.backendUrl + "auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: conn.refreshToken }),
  });
  if (res.status === 401) throw new UserFacingError("MKT System từ chối mã kết nối (hết hạn hoặc đã đăng xuất).");
  if (!res.ok) throw new Error(`MKT /auth lỗi HTTP ${res.status}`);
  const token = (await res.json())?.dataSource?.accessToken;
  if (!token) throw new Error("MKT /auth không trả accessToken.");

  return async function post(p, body) {
    const r = await fetch(conn.backendUrl + p, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`MKT ${p} lỗi HTTP ${r.status}${json?.message ? `: ${String(json.message).slice(0, 200)}` : ""}`);
    return json;
  };
}

/** The first array found in an API envelope: the value itself, or dataSource / items / data / rows / list. */
function listOf(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") {
    for (const k of ["dataSource", "items", "data", "rows", "list", "result"]) {
      const v = listOf(x[k]);
      if (v.length) return v;
    }
  }
  return [];
}

/* ─────────────────────────── intraday rows ─────────────────────────── */

/** Minimal zip reader (stored + deflate), enough for the intraday export. */
function unzip(buf) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buf.lastIndexOf(sig);
  if (eocd < 0) throw new Error("File zip intraday hỏng (không có central directory).");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("File zip intraday hỏng.");
    const method = buf.readUInt16LE(off + 10);
    const size = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = zlib.inflateRawSync(data);
    else throw new Error(`Zip method ${method} chưa hỗ trợ.`);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function columnarToObjects(c) {
  if (typeof c === "string") c = JSON.parse(c);
  if (!c || !Array.isArray(c.columns) || !Array.isArray(c.rows)) throw new Error("Dữ liệu intraday không đúng dạng columns/rows.");
  return c.rows.map((r) => Object.fromEntries(c.columns.map((col, i) => [col, r[i]])));
}

/** Same call as the Intraday page: prepare → inline columnar data or a zip on S3. */
async function fetchIntraday(post, body) {
  const res = await post(INTRADAY + "zip/prepare", body);
  const f = res?.dataSource ?? res;
  if (Array.isArray(f)) return { rows: f, meta: null };
  if (f?.format === "json-inline-columnar-v1") return { rows: columnarToObjects(f.inlineData), meta: null };
  if (f?.format === "json-zip-columnar-v1") {
    if (!f.downloadUrl) throw new Error("MKT không trả downloadUrl cho file intraday.");
    const dl = await fetch(f.downloadUrl);
    if (!dl.ok) throw new Error(`Tải file intraday lỗi HTTP ${dl.status}`);
    const files = unzip(Buffer.from(await dl.arrayBuffer()));
    if (!files["intraday.json"]) throw new Error("File intraday thiếu intraday.json.");
    const meta = files["meta.json"] ? JSON.parse(files["meta.json"].toString("utf8")) : null;
    return { rows: columnarToObjects(files["intraday.json"].toString("utf8")), meta };
  }
  throw new Error(`MKT trả định dạng intraday lạ: ${f?.format ?? typeof f}`);
}

/* ─────────────────────────── products ─────────────────────────── */

function productInfo(p) {
  if (p === null || typeof p !== "object") return { id: p, name: String(p ?? ""), texts: [String(p ?? "")] };
  const id = p.id ?? p.product_id ?? p.value ?? p.productId ?? p.code;
  const name = p.name ?? p.product_name ?? p.label ?? p.app_name ?? p.productName ?? "";
  const texts = [id, name, p.code, p.product_code, p.app_code, p.short_name, p.label]
    .filter((v) => v !== undefined && v !== null && v !== "").map(String);
  return { id, name: String(name), texts };
}

/** product code → { id, name } using the Intraday page's own product list. */
function matchProducts(list) {
  const infos = list.map(productInfo);
  const found = {};
  for (const code of PRODUCTS) {
    const word = new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`, "i");
    const hit =
      infos.find((p) => p.texts.some((t) => t.toUpperCase() === code)) ||
      infos.find((p) => p.texts.some((t) => word.test(t)));
    if (hit) found[code] = hit;
  }
  return found;
}

/* ─────────────────────────── metrics ─────────────────────────── */

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const countryOf = (r) => String(r.country_name ?? r.country ?? r.country_code ?? r.geo ?? "").trim();
const isUS = (r) => US.has(countryOf(r).toUpperCase());

function rowProductCode(row, byId) {
  const raw = String(row.product_id ?? row.productId ?? row.product ?? "").trim();
  if (!raw) return null;
  if (byId.has(raw.toLowerCase())) return byId.get(raw.toLowerCase());
  return PRODUCTS.find((c) => raw.toUpperCase().includes(c)) || null;
}

function emptySums() {
  return { spend: 0, rev: 0, installs: 0, usSpend: 0, usRev: 0, usInstalls: 0, rows: 0 };
}

function sumRows(rows, byId, revField, usRows = null) {
  const out = Object.fromEntries(PRODUCTS.map((c) => [c, emptySums()]));
  for (const r of rows) {
    const code = rowProductCode(r, byId);
    if (!code || !out[code]) continue;
    const s = out[code];
    s.rows++;
    s.spend += num(r.total_spen);
    s.rev += num(r[revField]);
    s.installs += num(r.total_install_mmp);
    if (!usRows && isUS(r)) {
      s.usSpend += num(r.total_spen);
      s.usRev += num(r[revField]);
      s.usInstalls += num(r.total_install_mmp);
    }
  }
  // Rows without a country column: US numbers come from a second, US-only request.
  for (const r of usRows || []) {
    const code = rowProductCode(r, byId);
    if (!code || !out[code]) continue;
    out[code].usSpend += num(r.total_spen);
    out[code].usRev += num(r[revField]);
    out[code].usInstalls += num(r.total_install_mmp);
  }
  return out;
}

const div = (a, b) => (b > 0 ? a / b : null);
function metrics(s) {
  if (!s) return null;
  return {
    spend: s.spend,
    roas: div(s.rev, s.spend),
    cpiUS: div(s.usSpend, s.usInstalls),
    ltvUS: div(s.usRev, s.usInstalls),
  };
}

/* ─────────────────────────── snapshot history (encrypted) ─────────────────────────── */

function snapshotKey() {
  const secret = env.SNAPSHOT_KEY || WEBHOOK;
  return secret ? crypto.createHash("sha256").update("mkt-report-snapshot|" + secret).digest() : null;
}

function loadHistory() {
  const key = snapshotKey();
  if (!key || !fs.existsSync(STATE_FILE)) return [];
  try {
    const buf = Buffer.from(fs.readFileSync(STATE_FILE, "utf8"), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const list = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    log("snapshot history unreadable (key changed?) — starting fresh");
    return [];
  }
}

function saveHistory(list) {
  const key = snapshotKey();
  if (!key) return;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(list), "utf8"), c.final()]);
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64"));
}

function findYesterday(history, now) {
  const target = now.getTime() - DAY;
  let best = null;
  for (const s of history) {
    const gap = Math.abs(new Date(s.at).getTime() - target);
    if (gap <= COMPARE_WINDOW && (!best || gap < best.gap)) best = { snap: s, gap };
  }
  return best?.snap || null;
}

/* ─────────────────────────── Discord ─────────────────────────── */

const money = (v) =>
  v === null || v === undefined ? "—"
    : "$" + v.toLocaleString("en-US", { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v >= 1000 ? 0 : 2 });
const unit = (v) => (v === null || v === undefined ? "—" : "$" + v.toFixed(v >= 1 ? 2 : 3));
const pct = (v) => (v === null || v === undefined ? "—" : (v * 100).toFixed(1) + "%");

/**
 * The comparison line under a value. `better`: +1 when up is good, −1 when up
 * is bad, 0 when neither (spend). ROAS moves in percentage points (pp), the rest in %.
 */
function delta(cur, prev, { better, fmt, points = false }) {
  if (prev === undefined) return "_chưa có số hôm qua_";
  if (cur === null || prev === null) return `hôm qua ${fmt(prev)}`;
  const diff = points ? (cur - prev) * 100 : prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  if (diff === null) return `hôm qua ${fmt(prev)}`;
  const flat = Math.abs(diff) < 0.05;
  const arrow = flat ? "▪️" : better === 0 ? (diff > 0 ? "🔼" : "🔽") : diff * better > 0 ? "🟢" : "🔴";
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  return `${arrow} ${sign}${Math.abs(diff).toFixed(1)}${points ? "pp" : "%"} · hôm qua ${fmt(prev)}`;
}

/** "AAP861 - Photo Editor" / "Cleaner (AAP887)" → the name without the code. */
function cleanName(code, name) {
  return String(name || "")
    .replace(new RegExp(`[([]?\\b${code}\\b[)\\]]?`, "ig"), "")
    .replace(/^[\s\-–—|:·_]+|[\s\-–—|:·_]+$/g, "")
    .trim();
}

function productEmbed(code, name, cur, prev, hasPrev) {
  const label = cleanName(code, name);
  const pv = (k) => (hasPrev ? (prev ? prev[k] : null) : undefined);
  const roasTrend = hasPrev && prev && cur.roas !== null && prev.roas !== null ? Math.sign(cur.roas - prev.roas) : 0;
  return {
    title: label ? `${code} · ${label}`.slice(0, 256) : code,
    color: roasTrend > 0 ? 0x2ecc71 : roasTrend < 0 ? 0xe74c3c : 0x95a5a6,
    fields: [
      { name: "💰 Spend", value: `**${money(cur.spend)}**\n${delta(cur.spend, pv("spend"), { better: 0, fmt: money })}`, inline: true },
      { name: "📈 ROAS", value: `**${pct(cur.roas)}**\n${delta(cur.roas, pv("roas"), { better: 1, fmt: pct, points: true })}`, inline: true },
      { name: "​", value: "​", inline: true },
      { name: "🇺🇸 CPI US", value: `**${unit(cur.cpiUS)}**\n${delta(cur.cpiUS, pv("cpiUS"), { better: -1, fmt: unit })}`, inline: true },
      { name: "🇺🇸 LTV US", value: `**${unit(cur.ltvUS)}**\n${delta(cur.ltvUS, pv("ltvUS"), { better: 1, fmt: unit })}`, inline: true },
      { name: "​", value: "​", inline: true },
    ],
  };
}

async function discord(payload) {
  if (MODE === "dry") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (!WEBHOOK) throw new UserFacingError("Chưa có webhook Discord (secret `DISCORD_WEBHOOK_URL`).");
  if (!/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(WEBHOOK)) {
    throw new UserFacingError("`DISCORD_WEBHOOK_URL` không phải webhook Discord.");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "MKT Report", allowed_mentions: { parse: [] }, ...payload }),
    });
    if (res.ok) return;
    if (res.status === 429) {
      const wait = Number((await res.json().catch(() => ({})))?.retry_after || 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      continue;
    }
    throw new Error(`Discord webhook lỗi HTTP ${res.status}`);
  }
  throw new Error("Discord webhook bị giới hạn tốc độ.");
}

/* ─────────────────────────── main ─────────────────────────── */

async function collect(conn) {
  const post = await mktClient(conn);
  const dates = { from_date: endOfVnDay(), to_date: endOfVnDay() };

  const productList = listOf(await post(INTRADAY + "products", dates));
  const matched = matchProducts(productList);
  const ids = Object.values(matched).map((p) => p.id);
  const byId = new Map(Object.entries(matched).map(([code, p]) => [String(p.id).toLowerCase(), code]));
  for (const code of PRODUCTS) byId.set(code.toLowerCase(), code);

  const { rows, meta } = ids.length ? await fetchIntraday(post, { ...dates, product_ids: ids }) : { rows: [], meta: null };

  const hasCountry = rows.some((r) => countryOf(r) !== "");
  let usRows = null;
  if (rows.length && !hasCountry) {
    // No country column in this account's rows: ask for US only, with the value
    // the page's own country filter uses.
    const countries = listOf(await post(INTRADAY + "countries", { ...dates, product_ids: ids }));
    const usOpt = countries.find((c) => {
      const vals = typeof c === "object" && c ? Object.values(c) : [c];
      return vals.some((v) => US.has(String(v).trim().toUpperCase()));
    });
    if (usOpt !== undefined) {
      const val = typeof usOpt === "object" ? usOpt.value ?? usOpt.code ?? usOpt.country_code ?? usOpt.id ?? usOpt.name : usOpt;
      usRows = (await fetchIntraday(post, { ...dates, product_ids: ids, countries: [val] })).rows;
    } else {
      usRows = [];
    }
  }

  const revField = rows.length && !rows.some((r) => r[REVENUE_FIELD] !== undefined) ? "total_revenue" : REVENUE_FIELD;
  return { productList, matched, rows, meta, usRows, hasCountry, revField, sums: sumRows(rows, byId, revField, usRows) };
}

function lastUpdated(rows) {
  let max = 0;
  for (const r of rows) {
    const t = Date.parse(r.last_updated ?? "");
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max ? new Date(max) : null;
}

async function runDebug(conn) {
  const c = await collect(conn);
  const cols = c.rows.length ? Object.keys(c.rows[0]) : [];
  const distinct = (k, n = 12) => [...new Set(c.rows.map((r) => String(r[k] ?? "∅")))].slice(0, n).join(", ");
  const perProduct = PRODUCTS.map((code) => {
    const m = c.matched[code];
    return `${code}: ${m ? `id=${m.id} "${m.name}" · ${c.sums[code].rows} dòng` : "KHÔNG TÌM THẤY"}`;
  });
  const lines = [
    `**🔧 MKT report — debug** (${hhmm(new Date())} ${ddmm(new Date())})`,
    "```",
    `Tài khoản: ${conn.email} · mã hết hạn ${hhmm(new Date(conn.expiresAt))} ${ddmm(new Date(conn.expiresAt))}`,
    `Danh sách sản phẩm: ${c.productList.length} · ví dụ: ${JSON.stringify(c.productList[0] ?? null).slice(0, 160)}`,
    ...perProduct,
    `Số dòng intraday: ${c.rows.length} · có cột quốc gia: ${c.hasCountry ? "có" : "không"}${c.usRows ? ` · dòng US riêng: ${c.usRows.length}` : ""}`,
    `Cột doanh thu dùng cho ROAS/LTV: ${c.revField}`,
    `type: ${distinct("type")}`,
    `channel: ${distinct("channel")}`,
    `country_name: ${distinct("country_name")}`,
    `export_date: ${distinct("export_date", 4)} · last_updated: ${distinct("last_updated", 3)}`,
    "```",
  ];
  const colText = "**Các cột:**\n```" + (cols.join(", ") || "(không có dòng)").slice(0, 1800) + "```";
  await discord({ content: lines.join("\n").slice(0, 2000) });
  await discord({ content: colText });
  log(`debug sent: ${c.rows.length} rows, ${Object.keys(c.matched).length}/${PRODUCTS.length} products matched`);
}

async function runReport(conn) {
  const now = new Date();
  const c = await collect(conn);
  const history = loadHistory().filter((s) => now.getTime() - new Date(s.at).getTime() < KEEP_HISTORY);
  const yesterday = findYesterday(history, now);

  const embeds = PRODUCTS.map((code) => {
    const m = c.matched[code];
    if (!m) {
      return { title: code, color: 0x95a5a6, description: "⚠️ Không tìm thấy sản phẩm này trong MKT Intraday. Chạy workflow với mode **debug** để xem danh sách." };
    }
    const cur = metrics(c.sums[code]);
    const prev = yesterday ? metrics(yesterday.products?.[code]) : null;
    return productEmbed(code, m.name, cur, prev, !!yesterday);
  });

  const updated = lastUpdated(c.rows);
  const lines = [
    `## 📊 MKT report ${hhmm(now)} · ${ddmm(now)}`,
    yesterday
      ? `So với ${hhmm(new Date(yesterday.at))} ${ddmm(new Date(yesterday.at))} · ROAS = ${c.revField === REVENUE_FIELD ? "est revenue D0" : c.revField} / spend · CPI, LTV chỉ US`
      : "_Lần đầu chạy ở khung giờ này: từ mai mới có số so sánh cùng giờ hôm qua._",
  ];
  if (updated) embeds[embeds.length - 1].footer = { text: `MKT cập nhật lúc ${hhmm(updated)} ${ddmm(updated)}` };

  const next = nextScheduledRun(now);
  if (conn.expiresAt < next.getTime()) {
    lines.push(
      `⚠️ **Mã MKT hết hạn lúc ${hhmm(new Date(conn.expiresAt))} ${ddmm(new Date(conn.expiresAt))}** — trước lần chạy ${hhmm(next)} ${ddmm(next)}. ` +
        "Lấy mã mới ở MKT System > Profile > Kết nối Claude rồi cập nhật secret `MKT_CONNECT_CODE` trên GitHub.",
    );
  }

  await discord({ content: lines.join("\n"), embeds });

  if (MODE !== "dry") {
    history.push({ at: now.toISOString(), products: c.sums });
    saveHistory(history);
  }
  log(`report sent: ${Object.keys(c.matched).length}/${PRODUCTS.length} products, compare=${yesterday ? "yes" : "no"}`);
}

async function main() {
  let conn;
  try {
    conn = parseConnectCode(env.MKT_CONNECT_CODE);
    if (MODE === "debug") await runDebug(conn);
    else await runReport(conn);
  } catch (err) {
    const msg = err instanceof UserFacingError ? err.message : `Lỗi: ${err.message}`;
    log("FAILED:", msg);
    const fix = /hết hạn|từ chối|Chưa có mã|không phải mã|bị hỏng|không đúng định dạng/.test(msg)
      ? "\nLấy mã mới ở MKT System > Profile > Kết nối Claude rồi cập nhật secret `MKT_CONNECT_CODE` trên GitHub."
      : "";
    if (WEBHOOK && !/webhook/i.test(msg)) {
      await discord({ content: `❌ **MKT report ${hhmm(new Date())} ${ddmm(new Date())} không chạy được.** ${msg}${fix}` }).catch(() => {});
    }
    process.exitCode = 1;
  }
}

export { parseConnectCode, matchProducts, sumRows, metrics, findYesterday, loadHistory, saveHistory, unzip, endOfVnDay, nextScheduledRun, productEmbed, cleanName, main };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
