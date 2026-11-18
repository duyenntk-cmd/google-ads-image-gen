import { NextRequest, NextResponse } from "next/server";
import { userFromMcpKey } from "@/lib/mcpKey";
import { accessOf } from "@/lib/userAccess";
import { getStoreMeta } from "@/lib/storeMeta";
import { mostlyLatin, scriptOf } from "@/lib/adCopyCheck";
import { MARKETS, marketCode, todayVN, normTplName, templateName, genOf } from "@/lib/adTemplates";
import { parseConnectCode, createMktClient, validateAdContents, normaliseAdContents, ConnectCodeExpiredError, type AdContent, type MktClient } from "@/lib/mktClient";
import { logUsage } from "@/lib/usageLog";
import pkg from "@/package.json";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Claude connector (MCP, Streamable HTTP, stateless JSON responses).
 *
 * Added in Claude as a custom connector with the personal URL shown on the
 * MKT System page: /api/mcp/<key>. It lets a chat run the Banner + Ad Copy
 * flow without the web form: Claude reads the app, writes and localizes the
 * ad copy itself, checks it here, shows a draft, and on "ok" creates the ad
 * templates on MKT System with Google++ names.
 *
 * The MKT connect code (mktmcp_…, from the Profile page's "Kết nối Claude")
 * comes with each MKT tool call: this server keeps no per-chat state.
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const WEB = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "https://google-ads-image-gen.vercel.app";
const TPL_BASE = "automation-facebook/ad-templates";

/* ───────────────────────── auth ───────────────────────── */

/**
 * A key is honoured while its user has an active row in the Users sheet
 * (lib/userAccess.ts: cached 5 min, last good copy on a sheet outage).
 * Keys carry the session email, "<username>@ads-gen.internal" for accounts
 * without one; userAccess maps it back to the sheet's username.
 */
async function userActive(user: string): Promise<boolean> {
  const access = await accessOf(user);
  return !access || access.active;
}

/* ───────────────────────── guide ───────────────────────── */

const GUIDE = `# Tạo ad template Google từ chat (Banner + Ad Copy, không qua form web)

## Cú pháp lệnh người dùng hay gõ
@adtemp <link App Store / Google Play> <thị trường, vd VN, US, TH> [ghi chú góc quảng cáo] [banner]
Ví dụ: "@adtemp https://play.google.com/store/apps/details?id=com.x VN, US góc: tạo ảnh AI tết"

## Quy trình (luôn theo đúng thứ tự)
1. app_info(store_url) để biết app làm gì. Thị trường thiếu thì hỏi.
2. Cần mã kết nối MKT (mktmcp_…, MKT System > Profile > nút "Kết nối Claude", hiệu lực ~24h). Chưa có thì xin người dùng; có rồi thì mkt_status để báo đang dùng mã của ai.
3. Tự viết ad copy (bạn là người viết, không có tool viết hộ):
   - Mỗi thị trường 1 template, mỗi template 1–5 khối (block). Mặc định 3 khối, mỗi khối là một góc khác nhau (lợi ích chính, tính năng nổi bật, cảm xúc/xã hội...).
   - Mỗi khối: đúng 5 headline (≤30 ký tự, KHÁC NHAU) và 5 description (≤90 ký tự). Tối thiểu Google chấp nhận: 2 headline khác nhau + 1 description.
   - Không viết CTA (App campaign không dùng). Không hứa điều app không làm, không dùng "tốt nhất/số 1" nếu không có căn cứ.
   - Viết bằng ngôn ngữ của thị trường (bảng bên dưới), chữ viết bản địa; không trộn tiếng Anh (Taglish, Hinglish...). Chỉ tên app và chữ "AI" được giữ nguyên.
   - Localize cho tự nhiên, không dịch từng chữ; quá dài thì viết lại cho vừa.
4. check_ad_copy với toàn bộ template. Còn lỗi thì tự sửa rồi kiểm tra lại cho tới khi hết lỗi.
5. mkt_next_gen để lấy số Gen hôm nay, rồi HIỆN NHÁP cho người dùng: mỗi thị trường một bảng (headline | số ký tự, description | số ký tự) và tên template sẽ tạo ("Ad Template <ngày> Gen<n> <thị trường>"). Hỏi: gõ "ok" để đẩy, hoặc nói cần sửa gì.
6. CHỈ khi người dùng đồng ý (ok / đẩy / được...) mới gọi mkt_push_ad_templates với đúng nội dung đã duyệt và đúng số Gen đã báo. Sửa sau khi đã đẩy: gọi lại với cùng Gen, template trùng tên sẽ được cập nhật.
7. Báo kết quả: tên từng template đã tạo/cập nhật.

## Banner (chỉ khi lệnh có chữ "banner")
Banner phải gen trên web vì chữ được vẽ lên ảnh trong trình duyệt. Gọi banner_link với cùng Gen và thị trường để lấy link mở sẵn trang Banner + Ad Copy; creative đẩy từ đó mang tag "<ngày> Gen<n>" nên khớp với template vừa tạo.

## Ngôn ngữ theo thị trường
${Object.entries(MARKETS).map(([k, v]) => `${k}: ${v.language}`).join(" · ")}`;

/* ───────────────────────── tools ───────────────────────── */

type Json = Record<string, unknown>;
interface Tool { name: string; description: string; inputSchema: Json; annotations?: Json; run: (a: Json, user: string) => Promise<Json | string> }

const blocksSchema = {
  type: "array",
  minItems: 1,
  maxItems: 5,
  items: {
    type: "object",
    properties: {
      headlines: { type: "array", items: { type: "string" }, description: "2–5 headlines, ≤30 characters each, all different" },
      descriptions: { type: "array", items: { type: "string" }, description: "1–5 descriptions, ≤90 characters each" },
    },
    required: ["headlines", "descriptions"],
  },
};
const templatesSchema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    properties: {
      market: { type: "string", description: "ISO market code, e.g. VN, US, TH" },
      blocks: blocksSchema,
    },
    required: ["market", "blocks"],
  },
};
const mktCodeSchema = { type: "string", description: "MKT System connect code (starts with mktmcp_), from MKT System > Profile > Kết nối Claude" };

function mkt(a: Json): MktClient {
  return createMktClient(parseConnectCode(String(a.mkt_code || "")));
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

interface TplIn { market: string; blocks: AdContent[] }
function readTemplates(a: Json): TplIn[] {
  const list = Array.isArray(a.templates) ? (a.templates as Json[]) : [];
  return list.map(t => ({
    market: marketCode(str(t.market)),
    blocks: (Array.isArray(t.blocks) ? (t.blocks as Json[]) : []).map(b => ({
      headlines: Array.isArray(b.headlines) ? (b.headlines as unknown[]).map(String) : [],
      descriptions: Array.isArray(b.descriptions) ? (b.descriptions as unknown[]).map(String) : [],
    })),
  }));
}

/** Errors (block the push) and warnings (worth fixing) per market. */
function checkTemplates(tpls: TplIn[], appName: string) {
  const seen = new Set<string>();
  return tpls.map(t => {
    const errors = validateAdContents(t.blocks);
    const warnings: string[] = [];
    if (!t.market) errors.push("Thiếu mã thị trường.");
    if (seen.has(t.market)) errors.push(`Thị trường ${t.market} bị lặp: gộp các khối vào một template.`);
    seen.add(t.market);
    if (t.market && !MARKETS[t.market]) warnings.push(`Mã thị trường "${t.market}" lạ, kiểm tra lại (vd VN, US, TH).`);
    const language = MARKETS[t.market]?.language || "";
    const script = scriptOf(language);
    t.blocks.forEach((b, i) => {
      if (/\b(download now|tải ngay|install now)\b/i.test([...b.headlines, ...b.descriptions].join(" "))) {
        warnings.push(`Khối ${i + 1}: có câu kiểu CTA; App campaign không cần CTA.`);
      }
      if (script) {
        for (const line of [...b.headlines, ...b.descriptions]) {
          if (line.trim() && mostlyLatin(line, script, appName)) warnings.push(`Khối ${i + 1}: "${line}" chưa viết bằng chữ ${language}.`);
        }
      }
    });
    const counts = t.blocks.map(b => ({
      headlines: b.headlines.map(h => ({ text: h, chars: h.trim().length })),
      descriptions: b.descriptions.map(d => ({ text: d, chars: d.trim().length })),
    }));
    return { market: t.market, language, ok: !errors.length, errors, warnings, counts };
  });
}

async function nextGen(m: MktClient, date: string) {
  const list = await m.request<{ items?: { id?: string; name?: string }[] }>(
    `${TPL_BASE}?${new URLSearchParams({ channel: "google", page: "1", pageSize: "100", search: date })}`,
  );
  const items = list.items || [];
  const max = items.reduce((a, t) => Math.max(a, genOf(t.name || "", date)), 0);
  return { gen: max + 1, items };
}

const TOOLS: Tool[] = [
  {
    name: "get_guide",
    description: "Read FIRST when the user asks to create Google ad templates / ad copy / '@adtemp' for an app and push them to MKT System. Returns the step-by-step flow (draft → user says ok → push), copy rules, Google++ naming and market languages.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, title: "Hướng dẫn tạo ad template" },
    run: async () => GUIDE,
  },
  {
    name: "app_info",
    description: "Facts about an app from its App Store or Google Play link: name, developer, category, rating, store description. Use it before writing ad copy.",
    inputSchema: { type: "object", properties: { store_url: { type: "string" } }, required: ["store_url"] },
    annotations: { readOnlyHint: true, title: "Thông tin app" },
    run: async a => ({ ...(await getStoreMeta(str(a.store_url))) }),
  },
  {
    name: "check_ad_copy",
    description: "Validate ad templates before showing the draft or pushing: Google limits (2–5 different headlines ≤30 chars, 1–5 descriptions ≤90 chars per block, ≤5 blocks), duplicate markets, CTA-like lines, and lines not written in the market's own script. Returns per-market errors, warnings and character counts. Fix every error and re-check.",
    inputSchema: {
      type: "object",
      properties: { app_name: { type: "string", description: "App/brand name, allowed to stay in Latin letters" }, templates: templatesSchema },
      required: ["templates"],
    },
    annotations: { readOnlyHint: true, title: "Kiểm tra ad copy" },
    run: async a => {
      const res = checkTemplates(readTemplates(a), str(a.app_name));
      return { ok: res.every(r => r.ok), markets: res };
    },
  },
  {
    name: "mkt_status",
    description: "Check an MKT System connect code: whose account it is and when it expires. Tell the user whose code is in use.",
    inputSchema: { type: "object", properties: { mkt_code: mktCodeSchema }, required: ["mkt_code"] },
    annotations: { readOnlyHint: true, title: "Kiểm tra mã MKT" },
    run: async a => {
      const conn = parseConnectCode(str(a.mkt_code));
      return { email: conn.email, expiresAt: new Date(conn.expiresAt).toISOString(), hoursLeft: Math.max(0, Math.round((conn.expiresAt - Date.now()) / 36e5 * 10) / 10) };
    },
  },
  {
    name: "mkt_next_gen",
    description: "The Gen number for today's new batch on MKT System (today's highest 'Ad Template <day> Gen<n>' + 1) and the template names that would be created. Call it right before showing the draft.",
    inputSchema: {
      type: "object",
      properties: { mkt_code: mktCodeSchema, markets: { type: "array", items: { type: "string" } } },
      required: ["mkt_code"],
    },
    annotations: { readOnlyHint: true, title: "Lấy số Gen" },
    run: async a => {
      const date = todayVN();
      const { gen, items } = await nextGen(mkt(a), date);
      const markets = (Array.isArray(a.markets) ? (a.markets as unknown[]) : []).map(x => marketCode(String(x)));
      return {
        date,
        gen,
        names: markets.map(mk => templateName(date, gen, mk)),
        creativeTags: [`${date} Gen${gen}`],
        alreadyToday: items.map(t => t.name).filter(Boolean).slice(0, 30),
      };
    },
  },
  {
    name: "mkt_push_ad_templates",
    description: "Create the Google ad templates on MKT System, one per market, named 'Ad Template <day> Gen<gen> <market>'. ONLY call this after the user has seen the draft and said ok. A template with the same name (same day, Gen and market) is updated instead of duplicated. Everything is validated first; nothing is sent if any template has errors.",
    inputSchema: {
      type: "object",
      properties: {
        mkt_code: mktCodeSchema,
        gen: { type: "integer", minimum: 1, description: "The Gen shown in the draft (from mkt_next_gen)" },
        app_name: { type: "string" },
        templates: templatesSchema,
      },
      required: ["mkt_code", "gen", "templates"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, title: "Đẩy ad template lên MKT" },
    run: async (a, user) => {
      const tpls = readTemplates(a);
      const gen = Math.floor(Number(a.gen));
      if (!Number.isFinite(gen) || gen < 1) throw new Error("Thiếu số Gen hợp lệ (lấy từ mkt_next_gen).");
      const checked = checkTemplates(tpls, str(a.app_name));
      const bad = checked.filter(c => !c.ok);
      if (bad.length) return { pushed: false, error: "Còn lỗi, chưa đẩy gì lên MKT.", markets: bad.map(b => ({ market: b.market, errors: b.errors })) };

      const m = mkt(a);
      const date = todayVN();
      const { items } = await nextGen(m, date);
      const results: Json[] = [];
      for (const t of tpls) {
        const name = templateName(date, gen, t.market);
        const blocks = normaliseAdContents(t.blocks);
        try {
          const same = items.find(x => normTplName(x.name || "") === normTplName(name));
          if (same?.id) {
            await m.request(`${TPL_BASE}/${same.id}`, { method: "PATCH", body: { name: same.name || name, channel: "google", adContents: blocks } });
            results.push({ market: t.market, name: same.name || name, id: same.id, action: "updated", blocks: blocks.length });
          } else {
            const created = await m.request<{ id?: string }>(TPL_BASE, { method: "POST", body: { name, channel: "google", adContents: blocks } });
            results.push({ market: t.market, name, id: created?.id || null, action: "created", blocks: blocks.length });
          }
        } catch (e) {
          results.push({ market: t.market, name, action: "error", error: (e as Error)?.message || String(e) });
        }
      }
      const okN = results.filter(r => r.action !== "error").length;
      logUsage(user, {
        tool: "Claude connector", action: "Tạo ad template", app: str(a.app_name),
        markets: tpls.map(t => t.market).join(", "), templates: okN,
        result: okN === results.length ? "ok" : okN ? "partial" : "error", note: `${date} Gen${gen}`,
      }, pkg.version).catch(() => {});
      return { pushed: okN > 0, date, gen, creativeTags: [`${date} Gen${gen}`], results };
    },
  },
  {
    name: "log_usage",
    description: "Record one finished piece of work in the team's usage log (UsageLog tab of the system Google Sheet), under the owner of this connector link. The Claude Code chat toolkit (chat/studio.mjs) calls it after generating banners, localizing or pushing to MKT, so work done in chat counts like work done on the web. Do not call it for drafts the user threw away.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Where the work was done, e.g. 'Chat Claude Code'" },
        action: { type: "string", description: "Same wording as the web where possible: 'Gen ảnh duyệt', 'Gen bộ ảnh', 'Localize', 'Tạo ad template', 'Đẩy lên MKT'" },
        app: { type: "string" },
        markets: { type: "string", description: "Comma-separated ISO codes" },
        images: { type: "integer", minimum: 0 },
        templates: { type: "integer", minimum: 0 },
        duration_sec: { type: "number", minimum: 0 },
        result: { type: "string", enum: ["ok", "partial", "error"] },
        note: { type: "string" },
      },
      required: ["action"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, title: "Ghi log sử dụng" },
    run: async (a, user) => {
      if (!str(a.action).trim()) throw new Error("Thiếu action.");
      const result = str(a.result);
      await logUsage(user, {
        tool: str(a.tool).trim() || "Chat Claude Code",
        action: str(a.action).trim(),
        app: str(a.app),
        markets: str(a.markets),
        images: Number(a.images) || 0,
        templates: Number(a.templates) || 0,
        durationSec: Number(a.duration_sec) || 0,
        result: result === "partial" || result === "error" ? result : "ok",
        note: str(a.note),
      }, pkg.version);
      return { logged: true, user };
    },
  },
  {
    name: "banner_link",
    description: "Only when the user asked for banners: a link that opens the web's Banner + Ad Copy page pre-filled with the app, market and the batch's Gen, so the banners pushed from there get the tag '<day> Gen<n>' and match the templates. Banners cannot be generated inside the chat (text is drawn onto the images in the browser).",
    inputSchema: {
      type: "object",
      properties: { store_url: { type: "string" }, market: { type: "string", description: "Main market, ISO code" }, gen: { type: "integer", minimum: 1 } },
      required: ["store_url", "gen"],
    },
    annotations: { readOnlyHint: true, title: "Link gen banner" },
    run: async a => {
      const qs = new URLSearchParams({ page: "aibanner", url: str(a.store_url), gen: String(Math.floor(Number(a.gen)) || 1) });
      const mk = marketCode(str(a.market));
      if (mk && MARKETS[mk]) qs.set("market", mk);
      return {
        url: `${WEB}/?${qs}`,
        note: "Mở link (đã đăng nhập web), bấm gen ảnh rồi đẩy creative như bình thường. Số Gen được giữ để creative khớp với template đã tạo từ chat; phần ad copy trên web để trống để không ghi đè template.",
      };
    },
  },
];

/* ───────────────────────── JSON-RPC ───────────────────────── */

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

function toolText(v: Json | string): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

async function handle(msg: Rpc, user: string): Promise<Json | null> {
  const isNote = msg.id === undefined || msg.id === null;
  const reply = (result: Json) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, result });
  const error = (code: number, message: string) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const asked = str(msg.params?.protocolVersion);
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "google-ads-studio", title: "Google Ads Studio", version: pkg.version },
        instructions: "Tạo ad template Google cho app và đẩy lên MKT System. Khi người dùng gõ '@adtemp' hoặc nhờ tạo ad template/ad copy: gọi get_guide trước và làm đúng quy trình (hiện nháp, chờ 'ok' rồi mới đẩy).",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
    case "tools/call": {
      const tool = TOOLS.find(t => t.name === msg.params?.name);
      if (!tool) return error(-32602, `Không có tool ${String(msg.params?.name)}`);
      try {
        const out = await tool.run((msg.params?.arguments as Json) || {}, user);
        return reply({ content: [{ type: "text", text: toolText(out) }], ...(typeof out === "object" ? { structuredContent: out } : {}) });
      } catch (e) {
        const err = e as Error & { status?: number };
        const text = e instanceof ConnectCodeExpiredError
          ? "Mã kết nối MKT đã hết hạn. Xin người dùng mã mới: MKT System > Profile > Kết nối Claude."
          : err?.message || "Lỗi không rõ.";
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      if (msg.method?.startsWith("notifications/")) return null;
      return error(-32601, `Không hỗ trợ ${String(msg.method)}`);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  let user: string | null = null;
  try { user = userFromMcpKey(decodeURIComponent(key || "")); } catch { user = null; }
  // 403, not 401: a 401 makes Claude start an OAuth sign-in this server does not offer.
  if (!user || !(await userActive(user))) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Link connector không hợp lệ hoặc tài khoản đã bị tắt. Lấy link mới ở trang MKT System của web." } }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const msgs = Array.isArray(body) ? (body as Rpc[]) : [body as Rpc];
  const out = (await Promise.all(msgs.map(m => handle(m, user!)))).filter(Boolean);
  if (!out.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? out : out[0], { headers: { "cache-control": "no-store" } });
}

/** No server-to-client stream: everything is answered in the POST response. */
export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { allow: "POST" } });
}
