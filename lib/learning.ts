import OpenAI from "openai";
import { getAccessToken, ensureTab, SPREADSHEET_ID } from "@/lib/sheetsLogger";
import {
  CORRECTION_KINDS, FEEDBACK_KIND, IMAGE_FIX_KINDS, LESSON_STATUS, LESSON_TARGETS,
  isLessonStatus, isLessonTarget,
  type FeedbackRow, type Lesson, type LessonStatus, type LessonTarget, type QualityRow,
} from "@/lib/learningShared";

/**
 * Learning loop: the tool gets better from what people keep correcting.
 *
 *  1. Feedback tab: one row each time a person corrects the AI's work (fixes
 *     one image, revises the whole set, regenerates without saying why,
 *     re-localizes with a note) or approves a draft. Web and chat both write it.
 *  2. proposeLessons(): AI reads the recent corrections, finds the ones that
 *     recur, and writes them as lessons in the BaiHoc tab, status "Chờ duyệt".
 *  3. A person approves ("Áp dụng"), edits or drops each lesson. Nothing reaches
 *     a prompt without that approval.
 *  4. lessonsBlock(): approved lessons are added to the prompt of the matching
 *     step (image, brief, localize, ad copy) on every following run.
 *  5. qualityStats(): image corrections per 100 generated images, per version,
 *     to check that the lessons actually reduced the corrections.
 */

const FEEDBACK_TAB = "Feedback";
const FEEDBACK_HEADER = ["Thời gian", "Ngày", "Email", "Công cụ", "Loại", "App", "Thị trường", "Ảnh", "Lý do", "Version"];
const LESSONS_TAB = "BaiHoc";
const LESSONS_HEADER = ["ID", "Ngày đề xuất", "Áp dụng cho (anh | brief | chu | adcopy)", "Bài học", "Bằng chứng", "Trạng thái (Chờ duyệt | Áp dụng | Bỏ)", "Người duyệt", "Ngày duyệt"];

/** At most this many lessons per prompt: past it they crowd out the brief. */
const MAX_LESSONS = 8;
const LESSON_MAX_CHARS = 300;
const BANNER_TOOLS = ["Banner + Ad Copy", "Chat Claude Code"];
const GEN_ACTIONS = ["Gen ảnh duyệt", "Gen bộ ảnh", "Gen lại ảnh"];

const clip = (v: unknown, n = 300) => String(v ?? "").slice(0, n);
const todayVN = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

/* ───────────────────────── sheet helpers ───────────────────────── */

const base = () => `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;

/** Rows below the header; [] when the tab does not exist yet. */
async function readRows(tab: string, cols: string): Promise<string[][]> {
  const token = await getAccessToken();
  const r = await fetch(`${base()}/${tab}!${cols}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 400) return [];
  if (!r.ok) throw new Error(`Không đọc được tab ${tab}: HTTP ${r.status}`);
  return ((await r.json()).values || []).slice(1) as string[][];
}

async function appendRows(tab: string, header: string[], rows: (string | number)[][]) {
  const token = await getAccessToken();
  await ensureTab(token, tab, header);
  const last = String.fromCharCode(64 + header.length);
  const r = await fetch(`${base()}/${tab}!A:${last}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  if (!r.ok) throw new Error(`Không ghi được tab ${tab}: HTTP ${r.status}`);
}

/* ───────────────────────── 1. feedback ───────────────────────── */

export interface FeedbackEvent {
  tool: string;
  kind: string;
  app?: string;
  markets?: string;
  /** Which image(s), e.g. "square-2". */
  slot?: string;
  /** What the person asked to change, in their words. */
  reason?: string;
}

export async function logFeedback(email: string, ev: FeedbackEvent, version: string) {
  const now = new Date();
  await appendRows(FEEDBACK_TAB, FEEDBACK_HEADER, [[
    now.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), todayVN(), clip(email), clip(ev.tool, 60), clip(ev.kind, 60),
    clip(ev.app, 120), clip(ev.markets, 200), clip(ev.slot, 200), clip(ev.reason, 1000), version,
  ]]);
}

export async function recentFeedback(limit = 30): Promise<FeedbackRow[]> {
  const rows = await readRows(FEEDBACK_TAB, "A:J");
  return rows.slice(-limit).reverse().map(r => ({
    time: r[0] || "", email: r[2] || "", tool: r[3] || "", kind: r[4] || "", app: r[5] || "",
    markets: r[6] || "", slot: r[7] || "", reason: r[8] || "", version: r[9] || "",
  }));
}

/* ───────────────────────── 2–3. lessons ───────────────────────── */

type StoredLesson = Lesson & { row: number };

export async function readLessons(): Promise<StoredLesson[]> {
  const rows = await readRows(LESSONS_TAB, "A:H");
  return rows
    .map((r, i) => ({ r, row: i + 2 }))
    .filter(({ r }) => r[0] && r[3])
    .map(({ r, row }) => ({
      id: r[0], proposedAt: r[1] || "",
      target: (isLessonTarget((r[2] || "").trim()) ? r[2].trim() : "anh") as LessonTarget,
      text: r[3] || "", evidence: r[4] || "",
      status: (isLessonStatus((r[5] || "").trim()) ? r[5].trim() : LESSON_STATUS.pending) as LessonStatus,
      reviewer: r[6] || "", reviewedAt: r[7] || "", row,
    }));
}

/**
 * Asks the model which corrections recur and turns them into lessons waiting
 * for approval. Feedback text is internal work data (see docs/du-lieu-va-bao-mat.md).
 */
export async function proposeLessons(): Promise<{ added: Lesson[]; considered: number }> {
  const since = Date.now() - 60 * 864e5;
  const feedback = (await readRows(FEEDBACK_TAB, "A:J")).filter(r =>
    CORRECTION_KINDS.includes(r[4]) && (r[8] || "").trim() && Date.parse(r[1] || "") >= since);
  if (feedback.length < 2) return { added: [], considered: feedback.length };
  const existing = await readLessons();

  const items = feedback.slice(-200).map(r => ({ loai: r[4], cong_cu: r[3], app: r[5], thi_truong: r[6], anh: r[7], ly_do: clip(r[8], 300) }));
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Bạn giúp một team UA cải thiện công cụ AI làm banner quảng cáo app (Google App campaign). " +
          "Đầu vào là các lần người duyệt phải sửa kết quả AI, kèm lý do họ viết. " +
          "Tìm các vấn đề LẶP LẠI (ít nhất 2 lần) và viết mỗi vấn đề thành MỘT bài học: một câu lệnh ngắn, cụ thể, " +
          "bằng tiếng Việt, đủ để thêm thẳng vào prompt của bước tương ứng và làm AI không mắc lại lỗi đó.\n" +
          "Bước (target): anh = prompt vẽ ảnh nền (bố cục, nhân vật, tay, đạo cụ, màu, điện thoại, vùng chừa chữ); " +
          "brief = chọn headline/phụ đề/CTA, màu, nhân vật trong brief; chu = dịch chữ trên banner sang thị trường khác; " +
          "adcopy = viết headline/description quảng cáo.\n" +
          "Không lặp ý một bài học đã có (kể cả bài đã bị bỏ). Không viết bài học chỉ đúng cho một app, trừ khi ghi rõ tên app trong câu. " +
          "Không đề xuất khi chỉ có 1 lần sửa. Tối đa 5 bài học.\n" +
          'Trả DUY NHẤT JSON: {"lessons":[{"target":"anh|brief|chu|adcopy","text":"...","count":<số lần sửa liên quan>,"examples":["lý do gốc 1","lý do gốc 2"]}]}',
      },
      {
        role: "user",
        content: JSON.stringify({
          bai_hoc_da_co: existing.map(l => ({ target: l.target, text: l.text, trang_thai: l.status })),
          cac_lan_sua: items,
        }),
      },
    ],
  });

  let parsed: { lessons?: { target?: unknown; text?: unknown; count?: unknown; examples?: unknown }[] } = {};
  try { parsed = JSON.parse(completion.choices[0]?.message?.content || "{}"); } catch { /* nothing usable */ }
  const seen = new Set(existing.map(l => l.text.trim().toLowerCase()));
  const day = todayVN();
  const prefix = `L${day.replace(/-/g, "")}-`;
  let n = existing.filter(l => l.id.startsWith(prefix)).length;

  const added: Lesson[] = [];
  for (const p of parsed.lessons || []) {
    const text = clip(p.text, LESSON_MAX_CHARS).trim();
    const count = Math.max(0, Math.round(Number(p.count) || 0));
    if (!text || !isLessonTarget(p.target) || count < 2 || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const examples = (Array.isArray(p.examples) ? p.examples : []).map(e => `"${clip(e, 120)}"`).slice(0, 3).join("; ");
    added.push({
      id: `${prefix}${++n}`, proposedAt: day, target: p.target, text,
      evidence: clip(`${count} lần sửa trong 60 ngày${examples ? `, ví dụ: ${examples}` : ""}`, 500),
      status: LESSON_STATUS.pending, reviewer: "", reviewedAt: "",
    });
  }
  if (added.length) {
    await appendRows(LESSONS_TAB, LESSONS_HEADER,
      added.map(l => [l.id, l.proposedAt, l.target, l.text, l.evidence, l.status, "", ""]));
  }
  return { added, considered: feedback.length };
}

/** A person approves, edits or drops a lesson. */
export async function reviewLesson(id: string, change: { status: LessonStatus; text?: string; target?: LessonTarget }, reviewer: string): Promise<Lesson> {
  const lesson = (await readLessons()).find(l => l.id === id);
  if (!lesson) throw new Error(`Không thấy bài học ${id}.`);
  const text = change.text !== undefined ? clip(change.text, LESSON_MAX_CHARS).trim() : lesson.text;
  if (!text) throw new Error("Bài học không được để trống.");
  const updated: Lesson = { ...lesson, text, target: change.target ?? lesson.target, status: change.status, reviewer: clip(reviewer, 120), reviewedAt: todayVN() };
  const token = await getAccessToken();
  const r = await fetch(`${base()}/${LESSONS_TAB}!C${lesson.row}:H${lesson.row}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[updated.target, updated.text, updated.evidence, updated.status, updated.reviewer, updated.reviewedAt]] }),
  });
  if (!r.ok) throw new Error(`Không ghi được tab ${LESSONS_TAB}: HTTP ${r.status}`);
  lessonCache = null;
  return updated;
}

/* ───────────────────────── 4. lessons into prompts ───────────────────────── */

let lessonCache: { at: number; byTarget: Partial<Record<LessonTarget, string[]>> } | null = null;
const LESSON_TTL_MS = 5 * 60_000;

/** Lessons passed in by the chat toolkit, which has no access to the sheet (chat/studio.mjs). */
function lessonsFromEnv(target: LessonTarget): string[] {
  try {
    const j = JSON.parse(process.env.TEAM_LESSONS_JSON || "{}");
    return Array.isArray(j[target]) ? j[target].map(String) : [];
  } catch {
    return [];
  }
}

/** Approved lessons for one step. Never throws: a sheet problem must not stop a generation. */
export async function approvedLessons(target: LessonTarget): Promise<string[]> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return lessonsFromEnv(target).slice(0, MAX_LESSONS);
  try {
    if (!lessonCache || Date.now() - lessonCache.at > LESSON_TTL_MS) {
      const byTarget: Partial<Record<LessonTarget, string[]>> = {};
      for (const l of await readLessons()) {
        if (l.status === LESSON_STATUS.applied && l.text.trim()) (byTarget[l.target] ||= []).push(l.text.trim());
      }
      lessonCache = { at: Date.now(), byTarget };
    }
  } catch (e) {
    console.error("lessons:", e instanceof Error ? e.message : e);
    // Keep the last good copy (or none) for a while instead of retrying on every image.
    lessonCache = { at: Date.now(), byTarget: lessonCache?.byTarget || {} };
  }
  return (lessonCache?.byTarget[target] || []).slice(0, MAX_LESSONS);
}

/** All approved lessons by step, for the chat toolkit (connector tool get_lessons). */
export async function approvedLessonsAll(): Promise<Record<LessonTarget, string[]>> {
  const out = {} as Record<LessonTarget, string[]>;
  for (const t of Object.keys(LESSON_TARGETS) as LessonTarget[]) out[t] = await approvedLessons(t);
  return out;
}

/** A prompt section listing the approved lessons for one step, or "" when there are none. */
export async function lessonsBlock(target: LessonTarget, header: string): Promise<string> {
  const lessons = await approvedLessons(target);
  return lessons.length ? `${header}\n${lessons.map(l => `- ${l.slice(0, LESSON_MAX_CHARS)}`).join("\n")}` : "";
}

/* ───────────────────────── 5. did it help ───────────────────────── */

/** Image corrections per 100 generated images, per version, over the last `days` days. */
export async function qualityStats(days = 90): Promise<QualityRow[]> {
  const since = Date.now() - days * 864e5;
  const recent = (date: string) => Date.parse(date || "") >= since;
  const [usage, feedback] = await Promise.all([readRows("UsageLog", "A:M"), readRows(FEEDBACK_TAB, "A:J")]);
  const by = new Map<string, QualityRow>();
  const row = (v: string) => {
    const key = v || "?";
    if (!by.has(key)) by.set(key, { version: key, images: 0, imageFixes: 0, per100: null, relocalize: 0, approvals: 0 });
    return by.get(key)!;
  };
  for (const u of usage) {
    if (!recent(u[1]) || !BANNER_TOOLS.includes(u[3]) || !GEN_ACTIONS.includes(u[4]) || u[10] === "error") continue;
    row(u[12]).images += Number(u[7]) || 0;
  }
  for (const f of feedback) {
    if (!recent(f[1])) continue;
    if (IMAGE_FIX_KINDS.includes(f[4])) row(f[9]).imageFixes++;
    else if (f[4] === FEEDBACK_KIND.relocalize) row(f[9]).relocalize++;
    else if (f[4] === FEEDBACK_KIND.approve) row(f[9]).approvals++;
  }
  const cmp = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });
  return [...by.values()]
    .map(r => ({ ...r, per100: r.images ? Math.round((r.imageFixes / r.images) * 1000) / 10 : null }))
    .sort((a, b) => cmp(a.version, b.version));
}
