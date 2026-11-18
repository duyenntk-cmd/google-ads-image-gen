#!/usr/bin/env node
/**
 * Chat toolkit: run the Banner + Ad Copy pipeline from a Claude Code chat,
 * with no browser and no web login.
 *
 * It starts this repo's own Next server on localhost and calls the same API
 * routes the web page calls (screenshots, banner-concept, banner-generate,
 * mkt/creatives, the MCP connector for ad templates), then draws the overlay
 * with lib/abRender.ts in headless Chromium. Same code, same output as the web.
 *
 * Credentials come from the environment, never from the chat:
 *   OPENAI_API_KEY       image + brief generation (or "proxy-injected" network secret)
 *   MKT_CONNECT_CODE     mktmcp_… from MKT System > Profile > Kết nối Claude (24h)
 *   GAIC_CONNECTOR_URL   the person's own connector link (web > MKT System > "Lấy link
 *                        connector của tôi"): names who is working and sends usage rows
 *                        to the team's UsageLog through the deployed web
 *
 * Usage: node chat/studio.mjs <command> [options]   (see `help`)
 */

import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning"); // Node's notice about importing lib/*.ts

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(ROOT, "chat", ".state");
const RUNS_DIR = path.join(ROOT, "chat", "runs");
const STATE_FILE = path.join(STATE_DIR, "server.json");
const PORT = Number(process.env.STUDIO_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const require = createRequire(path.join(ROOT, "package.json"));

/* ───────────────────────── small helpers ───────────────────────── */

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) opt[k] = true;
      else { opt[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const out = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };

function dataUrlToFile(dataUrl, file) {
  const comma = dataUrl.indexOf(",");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.slice(comma + 1), "base64"));
}
function fileToDataUrl(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
}
function extOf(dataUrl) {
  const t = dataUrl.slice(5, dataUrl.indexOf(";"));
  return t.includes("jpeg") || t.includes("jpg") ? "jpg" : t.includes("webp") ? "webp" : "png";
}

async function pool(items, limit, fn) {
  const res = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { res[i] = { ok: true, value: await fn(items[i], i) }; }
      catch (e) { res[i] = { ok: false, error: e?.message || String(e) }; }
    }
  }));
  return res;
}

const lib = async (name) => import(path.join(ROOT, "lib", `${name}.ts`));

/* ───────────────────────── credentials ───────────────────────── */

function mktCode(opt = {}) {
  if (opt["code-file"]) return fs.readFileSync(opt["code-file"], "utf8").trim();
  return (process.env.MKT_CONNECT_CODE || "").trim();
}

/* ───────────────────────── who is working, usage log ───────────────────────── */

const connectorUrl = () => (process.env.GAIC_CONNECTOR_URL || "").trim();

/** The web account behind the connector link (its key is "gaic_<username, base64url>.<signature>"). */
function chatUser() {
  const m = connectorUrl().match(/\/api\/mcp\/(?:gaic_|gaic%5F)([A-Za-z0-9_-]+)\./i);
  if (m) {
    try {
      const u = Buffer.from(m[1], "base64url").toString("utf8").trim().toLowerCase();
      if (u) return u;
    } catch { /* fall through */ }
  }
  return "chat";
}
const chatEmail = (u = chatUser()) => (u.includes("@") ? u : `${u}@ads-gen.internal`);

const PENDING_LOG = path.join(RUNS_DIR, "usage-pending.jsonl");

/** One tools/call to the DEPLOYED web's connector, through curl so the environment's proxy applies. */
function callConnector(name, args) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const raw = execFileSync("curl", ["-sS", "-m", "20", "-X", "POST", "-H", "content-type: application/json",
    "-H", "accept: application/json, text/event-stream", "--data-binary", "@-", connectorUrl()],
  { input: body, stdio: ["pipe", "pipe", "pipe"] }).toString();
  const data = JSON.parse(raw);
  if (data.error) throw new Error(data.error.message);
  if (data.result?.isError) throw new Error(data.result.content?.[0]?.text || "Lỗi tool.");
  return data.result?.structuredContent;
}

/**
 * Rows for the team's sheet, sent through the deployed web's connector:
 *   log_usage     UsageLog, same as the web (tool "Chat Claude Code"), so chat work is counted
 *   log_feedback  Feedback, what the user asked to fix: the learning loop's input
 * Without GAIC_CONNECTOR_URL, or when the web cannot be reached, a row waits in
 * chat/runs/usage-pending.jsonl and is sent with the next one that goes through.
 * Reporting never stops the work.
 */
function report(tool, args) {
  if (connectorUrl()) {
    try {
      callConnector(tool, args);
      if (fs.existsSync(PENDING_LOG)) {
        const left = [];
        for (const line of fs.readFileSync(PENDING_LOG, "utf8").split("\n").filter(Boolean)) {
          try {
            // Lines from before log_feedback existed carry no tool: they are usage rows.
            const { at, tool: t = "log_usage", args: a, ...legacy } = JSON.parse(line);
            const row = a || legacy;
            const note = t === "log_usage" ? { note: `${row.note || ""} (chạy lúc ${at})`.trim() } : {};
            callConnector(t, { ...row, ...note });
          } catch { left.push(line); }
        }
        if (left.length) fs.writeFileSync(PENDING_LOG, left.join("\n") + "\n");
        else fs.unlinkSync(PENDING_LOG);
      }
      return;
    } catch (e) {
      console.error(`! chưa ghi được ${tool === "log_usage" ? "log sử dụng" : "lần sửa"} (${String(e.stderr || e.message).trim().slice(0, 120)}), lưu tạm để gửi sau`);
    }
  } else {
    console.error("! chưa có GAIC_CONNECTOR_URL: log lưu tạm trong chat/runs/usage-pending.jsonl");
  }
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.appendFileSync(PENDING_LOG, JSON.stringify({ at: new Date().toISOString(), tool, args }) + "\n");
}

async function logUsage(ev) {
  report("log_usage", { tool: "Chat Claude Code", ...ev, duration_sec: Math.round(ev.duration_sec || 0) });
}

/** Kinds as in lib/learningShared.ts (FEEDBACK_KIND). */
const FEEDBACK = {
  fixOne: "Sửa 1 ảnh", fixSet: "Sửa cả bộ", redoOne: "Gen lại 1 ảnh (không ghi lý do)",
  redoSet: "Gen lại cả bộ (không ghi lý do)", relocalize: "Localize lại", approve: "Duyệt bản nháp",
};
async function logFeedback(ev) {
  report("log_feedback", { tool: "Chat Claude Code", ...ev });
}

/**
 * Lessons the team approved (web → Bài học), passed to the local server so chat
 * generations follow them like the web does. The local server cannot read the sheet.
 */
function teamLessons() {
  if (!connectorUrl()) return "";
  try {
    return JSON.stringify(callConnector("get_lessons", {}) || {});
  } catch (e) {
    console.error(`! chưa lấy được bài học đã duyệt (${String(e.stderr || e.message).trim().slice(0, 120)}); gen tiếp không kèm bài học`);
    return "";
  }
}

/* ───────────────────────── local server ───────────────────────── */

function readState() {
  try { return readJson(STATE_FILE); } catch { return null; }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Newest source mtime vs the build, so edits to the repo trigger a rebuild. */
function buildIsStale() {
  const id = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(id)) return true;
  const built = fs.statSync(id).mtimeMs;
  let newest = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  for (const d of ["app", "lib", "components"]) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  for (const f of ["proxy.ts", "package.json", "next.config.ts"]) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest > built;
}

async function up({ quiet = false } = {}) {
  const st = readState();
  if (st && alive(st.pid)) {
    try {
      const r = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (r.status < 500) return st;
    } catch { /* restart below */ }
  }
  if (!fs.existsSync(path.join(ROOT, "node_modules", "next"))) {
    if (!quiet) console.error("… cài thư viện (npm ci)");
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  }
  if (buildIsStale()) {
    if (!quiet) console.error("… build server cục bộ (1–2 phút)");
    execFileSync(path.join(ROOT, "node_modules", ".bin", "next"), ["build"], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, NEXTAUTH_SECRET: "build-only", NEXT_TELEMETRY_DISABLED: "1" },
    });
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const secret = crypto.randomBytes(32).toString("base64url");
  const log = fs.openSync(path.join(STATE_DIR, "server.log"), "a");
  const child = spawn(path.join(ROOT, "node_modules", ".bin", "next"), ["start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      NEXTAUTH_SECRET: secret,
      NEXTAUTH_URL: `http://localhost:${PORT}`,
      // With the key stored as a network secret for api.openai.com the session
      // never sees it: the proxy sets the Authorization header on the way out.
      // The routes still refuse to run without a value, so give them a placeholder.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "proxy-injected",
      // Node's fetch ignores HTTPS_PROXY unless told; outbound calls must use it here.
      NODE_USE_ENV_PROXY: "1",
      // The local server never writes to the team's sheet; usage rows go through
      // the deployed web (report above), so nothing is counted twice.
      GOOGLE_SERVICE_ACCOUNT_JSON: "",
      // Approved lessons from the learning loop (lib/learning.ts reads this when it has no sheet).
      TEAM_LESSONS_JSON: teamLessons(),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  child.unref();
  const state = { pid: child.pid, port: PORT, secret, startedAt: new Date().toISOString() };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (r.status < 500) return state;
    } catch { /* not yet */ }
  }
  die(`Server cục bộ không lên. Xem ${path.relative(ROOT, path.join(STATE_DIR, "server.log"))}`);
}

function down() {
  const st = readState();
  if (st && alive(st.pid)) {
    try { process.kill(-st.pid); } catch { try { process.kill(st.pid); } catch { /* gone */ } }
  }
  try { fs.unlinkSync(STATE_FILE); } catch { /* none */ }
}

/* ───────────────────────── calling the routes ───────────────────────── */

async function sessionCookie(secret) {
  const { encode } = require("next-auth/jwt");
  const user = chatUser();
  // checkedAt: fresh token per call, so the server does not look the person up in the Users sheet.
  const token = await encode({ token: { name: user, email: chatEmail(user), sub: user, provider: "chat", checkedAt: Date.now() }, secret, maxAge: 12 * 3600 });
  return `next-auth.session-token=${token}`;
}

async function api(method, route, body, opt = {}) {
  const st = await up({ quiet: true });
  const cookies = [await sessionCookie(st.secret)];
  const code = mktCode(opt);
  if (code) cookies.push(`mkt_connect=${code}`);
  const r = await fetch(BASE + route, {
    method,
    redirect: "manual",
    headers: { cookie: cookies.join("; "), ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  if (r.status >= 300 || data?.success === false) {
    const msg = data?.error === "not_connected"
      ? "Chưa có mã kết nối MKT (biến MKT_CONNECT_CODE)."
      : data?.error || data?.raw || `HTTP ${r.status}`;
    const e = new Error(`${route}: ${msg}`);
    e.detail = data?.detail;
    throw e;
  }
  return data;
}

/** Calls a tool of the repo's own MCP connector (ad templates), on the local server. */
async function mcpTool(name, args) {
  const st = await up({ quiet: true });
  process.env.NEXTAUTH_SECRET = st.secret; // mcpKey signs with it
  const { mcpKeyFor } = await lib("mcpKey");
  const r = await fetch(`${BASE}/api/mcp/${encodeURIComponent(mcpKeyFor(chatEmail()))}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  const res = data.result;
  if (res.isError) throw new Error(res.content?.[0]?.text || "Lỗi tool.");
  return res.structuredContent ?? res.content?.[0]?.text;
}

/* ───────────────────────── run folders ───────────────────────── */

function slug(s) {
  return String(s || "app").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "app";
}
function newRunDir(name) {
  const t = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace(/[-: ]/g, "").slice(0, 12);
  const dir = path.join(RUNS_DIR, `${t}-${slug(name)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function runDir(opt) {
  if (!opt.run) die("Thiếu --run <thư mục lượt chạy>.");
  const d = path.resolve(opt.run);
  if (!fs.existsSync(d)) die(`Không thấy ${d}`);
  return d;
}

/** Slot list: "core" (1 per ratio), "all" (20), or keys like landscape-1,square-2. */
async function pickSlots(spec) {
  const { APP_CREATIVES } = await lib("adFormats");
  const s = String(spec || "core");
  if (s === "all") return APP_CREATIVES;
  if (s === "core") return APP_CREATIVES.filter((c) => c.isCore);
  const keys = s.split(",").map((k) => k.trim()).filter(Boolean);
  const hit = APP_CREATIVES.filter((c) => keys.includes(c.key));
  const miss = keys.filter((k) => !hit.some((c) => c.key === k));
  if (miss.length) die(`Không có slot: ${miss.join(", ")}. Slot hợp lệ: ${APP_CREATIVES.map((c) => c.key).join(", ")}`);
  return hit;
}

/* ───────────────────────── commands ───────────────────────── */

/**
 * Where the OpenAI key comes from. A network secret is invisible here, so ask
 * OpenAI: a call carrying only the placeholder succeeds only if the proxy put
 * the real key in its place, which is exactly what the local server relies on.
 */
async function checkOpenAiKey() {
  const real = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "proxy-injected";
  try {
    const code = execFileSync("curl", ["-sS", "-o", "/dev/null", "-m", "15", "-w", "%{http_code}",
      "-H", `Authorization: Bearer ${real ? process.env.OPENAI_API_KEY : "proxy-injected"}`,
      "https://api.openai.com/v1/models"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    if (code === "200") return real ? "ok (biến môi trường OPENAI_API_KEY)" : "ok (Network secret cho api.openai.com)";
    if (code === "401") return real ? "OPENAI_API_KEY sai hoặc đã bị thu hồi" : "THIẾU: chưa có Network secret cho api.openai.com (hoặc biến OPENAI_API_KEY)";
    return `OpenAI trả HTTP ${code}`;
  } catch (e) {
    return /403/.test(String(e.stderr || e.message)) ? "BỊ CHẶN: api.openai.com chưa mở trong Network access" : `lỗi: ${String(e.stderr || e.message).trim().slice(0, 80)}`;
  }
}

async function cmdDoctor(opt) {
  const report = {};
  report.openaiKey = await checkOpenAiKey();
  const code = mktCode(opt);
  if (!code) report.mkt = "THIẾU MKT_CONNECT_CODE";
  else {
    try {
      const { parseConnectCode } = await lib("mktClient");
      const c = parseConnectCode(code);
      report.mkt = { email: c.email, backend: new URL(c.backendUrl).host, expiresAt: new Date(c.expiresAt).toISOString(), hoursLeft: Math.round((c.expiresAt - Date.now()) / 36e5 * 10) / 10 };
    } catch (e) { report.mkt = `Mã lỗi: ${e.message}`; }
  }
  if (!connectorUrl()) report.usageLog = "THIẾU GAIC_CONNECTOR_URL: việc làm trong chat không được tính vào log sử dụng";
  else {
    try {
      callConnector("get_guide", {});
      report.usageLog = `ok (ghi log dưới tên ${chatUser()})`;
    } catch (e) { report.usageLog = `Link connector lỗi: ${String(e.stderr || e.message).trim().slice(0, 120)}`; }
  }
  if (fs.existsSync(PENDING_LOG)) report.usagePending = fs.readFileSync(PENDING_LOG, "utf8").split("\n").filter(Boolean).length;
  const hosts = ["play.google.com", "play-lh.googleusercontent.com", "itunes.apple.com", "is1-ssl.mzstatic.com"];
  if (connectorUrl()) { try { hosts.push(new URL(connectorUrl()).host); } catch { /* reported above */ } }
  if (report.mkt?.backend) hosts.push(report.mkt.backend);
  report.network = {};
  await Promise.all(hosts.map(async (h) => {
    try {
      const r = execFileSync("curl", ["-sS", "-o", "/dev/null", "-m", "10", "-w", "%{http_code}", `https://${h}/`], { stdio: ["ignore", "pipe", "pipe"] }).toString();
      report.network[h] = `ok (${r})`;
    } catch (e) {
      const err = String(e.stderr || e.message);
      report.network[h] = /403/.test(err) ? "BỊ CHẶN (chưa mở trong Network access)" : `lỗi: ${err.trim().slice(0, 80)}`;
    }
  }));
  out(report);
}

async function cmdStore(url, opt) {
  if (!url) die("Thiếu link store.");
  const { MARKETS, marketCode } = await lib("adTemplates");
  const mk = marketCode(opt.market || "US");
  const country = MARKETS[mk]?.name || "Global";
  const language = opt.lang || MARKETS[mk]?.language || "English";
  let data;
  try {
    data = await api("POST", "/api/screenshots", { appUrl: url, country, language, limit: Number(opt.limit || 4) });
  } catch (e) {
    // Behind this environment's proxy a blocked host also answers 403, which the
    // route reports as Google's bot protection. doctor tells the two apart.
    throw new Error(`${e.message}\n→ Chạy "node chat/studio.mjs doctor" để xem store có bị chặn mạng không.`);
  }
  const dir = opt.run ? path.resolve(opt.run) : newRunDir(data.appName);
  const shots = [];
  data.screenshots.forEach((d, i) => {
    const f = path.join(dir, "shots", `shot-${i + 1}.${extOf(d)}`);
    dataUrlToFile(d, f);
    shots.push(path.relative(dir, f));
  });
  let icon = null;
  if (data.iconBase64) {
    icon = `icon.${extOf(data.iconBase64)}`;
    dataUrlToFile(data.iconBase64, path.join(dir, icon));
  }
  const info = {
    storeUrl: url, market: mk, country, language,
    appName: data.appName, platform: data.platform, developer: data.developer, genre: data.genre,
    rating: data.rating, description: data.description, icon, shots, via: data.via,
  };
  writeJson(path.join(dir, "app.json"), info);
  out({ run: path.relative(ROOT, dir), ...info, description: info.description?.slice(0, 300) + "…" });
}

async function cmdConcept(opt) {
  const dir = runDir(opt);
  const app = readJson(path.join(dir, "app.json"));
  const { MARKETS, marketCode } = await lib("adTemplates");
  const mk = marketCode(opt.market || app.market);
  const language = opt.lang || MARKETS[mk]?.language || app.language;
  const { brief } = await api("POST", "/api/banner-concept", {
    appName: app.appName,
    prompt: opt.prompt || "",
    country: MARKETS[mk]?.name || app.country,
    language,
    description: app.description,
    genre: app.genre,
    screenshots: app.shots.slice(0, 3).map((s) => fileToDataUrl(path.join(dir, s))),
  });
  const file = path.join(dir, opt.out || `brief.${mk}.json`);
  writeJson(file, brief);
  out({ file: path.relative(ROOT, file), brief });
}

async function cmdGen(opt) {
  const dir = runDir(opt);
  const app = readJson(path.join(dir, "app.json"));
  const briefFile = path.join(dir, opt.brief || `brief.${app.market}.json`);
  if (!fs.existsSync(briefFile)) die(`Không thấy ${path.relative(ROOT, briefFile)}. Chạy concept trước hoặc tự viết brief.`);
  const brief = readJson(briefFile);
  const slots = await pickSlots(opt.slots);
  const quality = ["low", "medium", "high"].includes(opt.quality) ? opt.quality : "medium";
  const shot = opt["no-screenshot"] ? null : app.shots[Number(opt.shot || 1) - 1];
  // The web finds or draws a mascot before the first set (auto-mascot is on by
  // default) and reuses it for every slot; same here, kept as mascot.png.
  let characterFile = opt.character ? path.resolve(opt.character) : null;
  if (!characterFile && !opt["no-mascot"]) {
    const m = path.join(dir, "mascot.png");
    if (!fs.existsSync(m)) await makeMascot(dir, app, brief, quality);
    if (fs.existsSync(m)) characterFile = m;
  }
  const character = characterFile ? fileToDataUrl(characterFile) : undefined;
  // Images already on disk: this run is a redo, or the approval to go from the draft to the full set.
  const before = fs.existsSync(path.join(dir, "base")) ? fs.readdirSync(path.join(dir, "base")).filter((f) => f.endsWith(".png")).length : 0;
  const t0 = Date.now();
  console.error(`… gen ${slots.length} ảnh nền (${quality}), 2 ảnh cùng lúc`);
  const res = await pool(slots, Number(opt.concurrency || 2), async (slot) => {
    const data = await api("POST", "/api/banner-generate", {
      brief,
      userPrompt: opt.prompt || "",
      quality,
      precise: Boolean(opt.precise),
      key: slot.key,
      width: slot.width,
      height: slot.height,
      angle: slot.angle,
      platform: app.platform,
      uiLanguage: app.language,
      referenceImages: shot ? [fileToDataUrl(path.join(dir, shot))] : [],
      ...(character && { characterImage: character }),
    });
    const img = data.images[0];
    const f = path.join(dir, "base", `${slot.key}.png`);
    dataUrlToFile(img.dataUrl, f);
    console.error(`  ✓ ${slot.key} (${data.model})`);
    return { key: slot.key, file: path.relative(ROOT, f), model: data.model };
  });
  const okN = res.filter((r) => r.ok).length;
  // Learning loop: redoing chosen images is a correction (with the user's words in
  // --prompt); going from the draft to the full set is the approval.
  const picked = opt.slots && opt.slots !== "core" && opt.slots !== "all";
  const reason = String(opt.prompt || "").trim();
  const fb = { app: app.appName, markets: app.market };
  if (picked) {
    await logFeedback({ ...fb, kind: reason ? FEEDBACK.fixOne : FEEDBACK.redoOne, slot: slots.map((s) => s.key).join(", "), reason });
  } else if (before > 0 && opt.slots === "all" && before < slots.length) {
    await logFeedback({ ...fb, kind: FEEDBACK.approve, reason: "" });
  } else if (before > 0) {
    await logFeedback({ ...fb, kind: reason ? FEEDBACK.fixSet : FEEDBACK.redoSet, reason });
  }
  await logUsage({
    action: opt.slots === "all" ? "Gen bộ ảnh" : picked ? "Gen lại ảnh" : "Gen ảnh duyệt",
    app: app.appName, markets: app.market, images: okN, duration_sec: (Date.now() - t0) / 1000,
    result: okN === slots.length ? "ok" : okN ? "partial" : "error", note: `${quality} · ${opt.slots || "core"}`,
  });
  out({
    seconds: Math.round((Date.now() - t0) / 1000),
    ok: res.filter((r) => r.ok).map((r) => r.value),
    failed: res.map((r, i) => (r.ok ? null : { key: slots[i].key, error: r.error })).filter(Boolean),
  });
}

/** /api/mascot: a character found in the screenshots, or a generated one. Failure is not fatal (the web carries on too). */
async function makeMascot(dir, app, brief, quality) {
  try {
    const shots = app.shots.map((s) => fileToDataUrl(path.join(dir, s)));
    const md = await api("POST", "/api/mascot", { appName: app.appName, niche: brief.niche, screenshots: shots, brief, quality });
    const url = md.source === "screenshot" ? shots[md.index] : md.dataUrl;
    if (!url) return null;
    const sharp = require("sharp");
    const f = path.join(dir, "mascot.png");
    await sharp(Buffer.from(url.slice(url.indexOf(",") + 1), "base64")).png().toFile(f);
    console.error(`  ✓ mascot (${md.source === "screenshot" ? `lấy từ screenshot ${md.index + 1}` : "gen mới"})`);
    return f;
  } catch (e) {
    console.error(`  ! không có mascot: ${e.message}`);
    return null;
  }
}

/** Banner text in other markets, drawn later on the SAME artwork (what the web's Localize does). */
async function cmdLocalize(opt) {
  const dir = runDir(opt);
  const app = readJson(path.join(dir, "app.json"));
  const { MARKETS, marketCode } = await lib("adTemplates");
  const from = marketCode(opt.from || app.market);
  const src = readJson(path.join(dir, `brief.${from}.json`));
  const targets = String(opt.to || "").split(",").map((s) => marketCode(s.trim())).filter(Boolean);
  if (!targets.length) die("Thiếu --to US,TH,…");
  const done = [];
  const t0 = Date.now();
  for (const mk of targets) {
    if (!MARKETS[mk]) die(`Mã thị trường lạ: ${mk}`);
    const r = await api("POST", "/api/banner-localize", {
      copy: { headline: src.headline, subheadline: src.subheadline, cta_text: src.cta_text, tagline: src.tagline || "" },
      language: MARKETS[mk].language,
      country: MARKETS[mk].name,
      appName: src.app_name,
      instructions: opt.note || "",
    });
    const f = path.join(dir, `brief.${mk}.json`);
    writeJson(f, { ...src, ...r.copy });
    done.push({ market: mk, file: path.relative(ROOT, f), copy: r.copy });
  }
  if (opt.note) await logFeedback({ kind: FEEDBACK.relocalize, app: src.app_name || app.appName, markets: targets.join(", "), reason: String(opt.note) });
  await logUsage({ action: opt.note ? "Localize lại" : "Localize", app: src.app_name || app.appName, markets: targets.join(", "), duration_sec: (Date.now() - t0) / 1000, note: opt.note || "" });
  out(done);
}

/** Overlay with lib/abRender.ts inside headless Chromium — the web page's exact drawing code. */
async function cmdCompose(opt) {
  const dir = runDir(opt);
  const app = readJson(path.join(dir, "app.json"));
  const set = opt.set || app.market;
  const brief = readJson(path.join(dir, opt.brief || `brief.${set}.json`));
  const { APP_CREATIVES } = await lib("adFormats");
  const bases = fs.existsSync(path.join(dir, "base")) ? fs.readdirSync(path.join(dir, "base")).filter((f) => f.endsWith(".png")) : [];
  let slots = APP_CREATIVES.filter((c) => bases.includes(`${c.key}.png`));
  if (opt.slots) {
    const want = (await pickSlots(opt.slots)).map((s) => s.key);
    slots = slots.filter((s) => want.includes(s.key));
  }
  if (!slots.length) die("Chưa có ảnh nền nào trong base/. Chạy gen trước.");

  const ts = require("typescript");
  const src = fs.readFileSync(path.join(ROOT, "lib", "abRender.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ type: "module", content: `${js}\nwindow.__ab = { abRenderBanner, abLoadImg };` });
    await page.waitForFunction(() => Boolean(window.__ab));
    const icon = app.icon ? fileToDataUrl(path.join(dir, app.icon)) : null;
    const done = [];
    for (const s of slots) {
      const baseUrl = fileToDataUrl(path.join(dir, "base", `${s.key}.png`));
      const dataUrl = await page.evaluate(async ({ baseUrl, icon, w, h, brief }) => {
        const base = await window.__ab.abLoadImg(baseUrl);
        const ic = icon ? await window.__ab.abLoadImg(icon) : null;
        await document.fonts.ready;
        return window.__ab.abRenderBanner(base, w, h, brief, ic);
      }, { baseUrl, icon, w: s.width, h: s.height, brief });
      const f = path.join(dir, "final", set, `${s.key}.png`);
      dataUrlToFile(dataUrl, f);
      done.push(path.relative(ROOT, f));
    }
    out({ set, files: done });
  } finally {
    await browser.close();
  }
}

/** One preview image of a set, so the chat can show the whole batch at once. */
async function cmdSheet(opt) {
  const dir = runDir(opt);
  const app = readJson(path.join(dir, "app.json"));
  const set = opt.set || app.market;
  const folder = path.join(dir, "final", set);
  if (!fs.existsSync(folder)) die(`Chưa có final/${set}. Chạy compose trước.`);
  const files = fs.readdirSync(folder).filter((f) => f.endsWith(".png")).sort();
  const cells = files.map((f) => `<figure><img src="${fileToDataUrl(path.join(folder, f))}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#eef0f4;font:14px system-ui,sans-serif;width:1600px}
    h1{font-size:20px;margin:0 0 16px}
    .g{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
    figure{margin:0;background:#fff;padding:8px;border-radius:8px;box-shadow:0 1px 3px #0002}
    img{display:block;height:300px;width:auto}
    figcaption{margin-top:6px;color:#555}
  </style></head><body><h1>${app.appName} · ${set} · ${files.length} ảnh</h1><div class="g">${cells}</div></body></html>`;
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1648, height: 800 } });
    await page.setContent(html);
    const f = path.join(dir, `preview-${set}.png`);
    await page.screenshot({ path: f, fullPage: true });
    out({ file: path.relative(ROOT, f) });
  } finally {
    await browser.close();
  }
}

async function cmdMkt(sub, opt) {
  const code = mktCode(opt);
  if (!code) die("Thiếu mã kết nối MKT: đặt biến môi trường MKT_CONNECT_CODE (MKT System > Profile > Kết nối Claude).");
  switch (sub) {
    case "status":
      return out(await mcpTool("mkt_status", { mkt_code: code }));
    case "next-gen":
      return out(await mcpTool("mkt_next_gen", { mkt_code: code, markets: String(opt.markets || "").split(",").map((s) => s.trim()).filter(Boolean) }));
    case "check-copy": {
      const t = readJson(path.resolve(opt.file || die("Thiếu --file templates.json")));
      return out(await mcpTool("check_ad_copy", { app_name: opt.app || "", templates: t.templates || t }));
    }
    case "push-templates": {
      const t = readJson(path.resolve(opt.file || die("Thiếu --file templates.json")));
      if (!opt.gen) die("Thiếu --gen (lấy từ mkt next-gen).");
      const t0 = Date.now();
      const tpls = t.templates || t;
      const res = await mcpTool("mkt_push_ad_templates", { mkt_code: code, gen: Number(opt.gen), app_name: opt.app || "", templates: tpls });
      const okN = (res?.results || []).filter((r) => r.action !== "error").length;
      if (res?.pushed !== undefined) {
        await logUsage({
          action: "Tạo ad template", app: opt.app || "", markets: tpls.map((x) => x.market).join(", "), templates: okN,
          duration_sec: (Date.now() - t0) / 1000, result: okN && okN === tpls.length ? "ok" : okN ? "partial" : "error", note: `${res.date || ""} Gen${opt.gen}`,
        });
      }
      return out(res);
    }
    case "push-creatives":
      return pushCreatives(opt);
    default:
      die("mkt status | next-gen | check-copy | push-templates | push-creatives");
  }
}

async function pushCreatives(opt) {
  const dir = runDir(opt);
  const app = readJson(path.join(dir, "app.json"));
  const set = opt.set || app.market;
  if (!opt.gen) die("Thiếu --gen (lấy từ mkt next-gen, trùng Gen của ad template).");
  const { todayVN, marketCode } = await lib("adTemplates");
  const date = opt.date || todayVN();
  const market = marketCode(opt.market || set);
  const tags = [`${date} Gen${Number(opt.gen)}`, market];
  const folder = path.join(dir, "final", set);
  if (!fs.existsSync(folder)) die(`Chưa có final/${set}.`);
  const files = fs.readdirSync(folder).filter((f) => f.endsWith(".png")).sort();
  const t0 = Date.now();

  // Same name, tags and thumbnail as the web's push (cbPushAll), so a batch
  // from the chat is indistinguishable from one pushed on the Banner page.
  const sharp = require("sharp");
  const list = (v) => String(v).split(",").map((s) => s.trim()).filter(Boolean);
  const items = await Promise.all(files.map(async (f) => {
    const file = path.join(folder, f);
    const thumb = await sharp(file).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    return {
      name: `${date}_Gen${Number(opt.gen)}_${market}_${f}`,
      dataUrl: fileToDataUrl(file),
      thumbnailDataUrl: `data:image/webp;base64,${thumb.toString("base64")}`,
      isPublic: false,
      tags,
      ...(opt.angle && { angleCodes: list(opt.angle) }),
      ...(opt.product && { productIds: list(opt.product) }),
    };
  }));

  // One file per request (each banner is a few MB as a data URL), then one bulk call.
  const prepared = await pool(items, 3, async (it) => (await api("POST", "/api/mkt/creatives", { mode: "upload", item: it }, opt)).prepared);
  const ok = prepared.filter((p) => p.ok).map((p) => p.value);
  const failed = prepared.map((p, i) => (p.ok ? null : { name: items[i].name, error: p.error })).filter(Boolean);
  if (!ok.length) die(`Không upload được file nào:\n${failed.map((f) => `${f.name}: ${f.error}`).join("\n")}`);
  const res = await api("POST", "/api/mkt/creatives", { mode: "bulk", items: ok, idempotencyKey: crypto.randomUUID() }, opt);
  const { fillMktLink, MKT_CREATIVE_URL } = await lib("mktLink");
  const report = {
    pushed: ok.length,
    failed,
    tags,
    creatives: Array.isArray(res.creatives) ? res.creatives.length : res.creatives,
    errors: res.errors?.length ? res.errors : undefined,
    open: fillMktLink(process.env.MKT_SYSTEM_URL || MKT_CREATIVE_URL, tags[0]),
  };
  writeJson(path.join(dir, `push-${set}.json`), { at: new Date().toISOString(), ...report });
  await logUsage({
    action: "Đẩy lên MKT", app: app.appName, markets: market, images: ok.length, duration_sec: (Date.now() - t0) / 1000,
    result: failed.length || res.errors?.length ? "partial" : "ok", note: tags[0],
  });
  out(report);
}

/**
 * A correction that did not go through gen/localize, e.g. the user changed the
 * banner text and Claude edited brief.<MK>.json. Logged for the learning loop.
 */
async function cmdFeedback(opt) {
  const dir = runDir(opt);
  const app = readJson(path.join(dir, "app.json"));
  const reason = String(opt.reason || "").trim();
  if (!reason) die('Thiếu --reason "<lời người dùng>".');
  const slot = typeof opt.slot === "string" ? opt.slot : "";
  await logFeedback({ app: app.appName, markets: opt.set || app.market, kind: slot ? FEEDBACK.fixOne : FEEDBACK.fixSet, slot, reason });
  out({ logged: true, kind: slot ? FEEDBACK.fixOne : FEEDBACK.fixSet });
}

/* ───────────────────────── main ───────────────────────── */

const HELP = `node chat/studio.mjs <lệnh>
  doctor                                   kiểm tra khoá, mã MKT, link connector (log sử dụng), mạng
  guide                                    luật viết ad copy + đặt tên Google++ (giống @adtemp)
  up | down                                bật / tắt server cục bộ (lệnh khác tự bật)
  store <link store> --market VN [--lang Vietnamese] [--run dir]
  concept --run dir [--market VN] [--lang ..] [--prompt "góc quảng cáo"] [--out brief.VN.json]
  gen --run dir [--brief brief.VN.json] [--slots core|all|landscape-1,..] [--quality low|medium|high] [--precise] [--prompt ..] [--no-screenshot] [--character ảnh.png | --no-mascot]
  localize --run dir [--from VN] --to US,TH [--note "ghi chú dịch"]
  compose --run dir --set VN [--brief brief.VN.json] [--slots ..]
  sheet --run dir --set VN                 ảnh xem trước cả bộ
  feedback --run dir --reason "lời người dùng" [--slot square-2] [--set US]   ghi một lần sửa không qua gen/localize (vd sửa chữ trong brief)
  mkt status | next-gen --markets VN,US | check-copy --file t.json | push-templates --file t.json --gen N
  mkt push-creatives --run dir --set VN --gen N [--market VN] [--angle A01] [--product id]`;

const [cmd, ...rest] = process.argv.slice(2);
const { pos, opt } = parseArgs(rest);
try {
  switch (cmd) {
    case "doctor": await cmdDoctor(opt); break;
    case "guide": out(await mcpTool("get_guide", {})); break;
    case "up": { const st = await up(); out({ server: BASE, pid: st.pid, startedAt: st.startedAt }); break; }
    case "down": down(); out("đã tắt"); break;
    case "store": await cmdStore(pos[0], opt); break;
    case "concept": await cmdConcept(opt); break;
    case "gen": await cmdGen(opt); break;
    case "localize": await cmdLocalize(opt); break;
    case "compose": await cmdCompose(opt); break;
    case "sheet": await cmdSheet(opt); break;
    case "feedback": await cmdFeedback(opt); break;
    case "mkt": await cmdMkt(pos[0], opt); break;
    default: out(HELP);
  }
} catch (e) {
  die(`${e.message}${e.detail ? `\n${JSON.stringify(e.detail).slice(0, 500)}` : ""}`);
}
