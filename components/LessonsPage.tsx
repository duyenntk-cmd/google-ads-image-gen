"use client";
import { useEffect, useState } from "react";
import {
  LESSON_STATUS, LESSON_TARGETS,
  type FeedbackRow, type Lesson, type LessonStatus, type LessonTarget, type QualityRow,
} from "@/lib/learningShared";

export interface LessonsTheme {
  text: string; textSub: string; textMuted: string; border: string; card: string;
  input: string; inputBorder: string; tabBg: string; cardShadow: string;
}

type Filter = LessonStatus | "all";
type Data = { stats: QualityRow[]; recent: FeedbackRow[]; lessons: Lesson[] };

async function fetchData(): Promise<Data> {
  const r = await fetch("/api/lessons", { cache: "no-store" });
  const d = await r.json();
  if (!d.success) throw new Error(d.error || `Lỗi ${r.status}`);
  return d;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STATUS_STYLE: Record<LessonStatus, { color: string; bg: string }> = {
  [LESSON_STATUS.pending]: { color: "#F59E0B", bg: "#F59E0B18" },
  [LESSON_STATUS.applied]: { color: "#10B981", bg: "#10B98118" },
  [LESSON_STATUS.dropped]: { color: "#94A3B8", bg: "#94A3B818" },
};

/**
 * Learning loop page (lib/learning.ts): how often people still correct the
 * AI's images, version by version; the lessons AI proposed from those
 * corrections, for a person to approve, edit or drop; the latest corrections.
 */
export default function LessonsPage({ t, canManage }: { t: LessonsTheme; canManage: boolean }) {
  const [stats, setStats] = useState<QualityRow[]>([]);
  const [recent, setRecent] = useState<FeedbackRow[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { text: string; target: LessonTarget }>>({});
  const [filter, setFilter] = useState<Filter>(LESSON_STATUS.pending);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const apply = (d: Data) => { setStats(d.stats); setRecent(d.recent); setLessons(d.lessons); setDrafts({}); };

  useEffect(() => {
    let alive = true;
    fetchData()
      .then(d => { if (alive) { setStats(d.stats); setRecent(d.recent); setLessons(d.lessons); } })
      .catch(e => { if (alive) setError(message(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const load = async () => {
    setLoading(true); setError("");
    try { apply(await fetchData()); } catch (e) { setError(message(e)); } finally { setLoading(false); }
  };

  const post = async (key: string, body: object) => {
    setBusy(key); setError(""); setNote("");
    try {
      const r = await fetch("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || `Lỗi ${r.status}`);
      return d;
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setBusy("");
    }
  };

  const propose = async () => {
    const d = await post("propose", { action: "propose" });
    if (!d) return;
    setNote(d.added.length
      ? `Có ${d.added.length} bài học mới chờ duyệt (từ ${d.considered} lần sửa có ghi lý do trong 60 ngày).`
      : `Chưa có vấn đề nào lặp lại đủ để thành bài học (đã đọc ${d.considered} lần sửa có ghi lý do trong 60 ngày).`);
    setFilter(LESSON_STATUS.pending);
    await load();
  };

  const review = async (l: Lesson, status: LessonStatus) => {
    const draft = drafts[l.id];
    const d = await post(l.id, { action: "review", id: l.id, status, ...(draft && { text: draft.text, target: draft.target }) });
    if (d) setLessons(prev => prev.map(x => (x.id === l.id ? d.lesson : x)));
    setDrafts(prev => { const n = { ...prev }; delete n[l.id]; return n; });
  };

  const shown = lessons.filter(l => filter === "all" || l.status === filter);
  const count = (s: LessonStatus) => lessons.filter(l => l.status === s).length;
  const card = { backgroundColor: t.card, borderColor: t.border, boxShadow: t.cardShadow };
  const input = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text };
  const maxPer100 = Math.max(1, ...stats.map(s => s.per100 ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: t.text }}>🧠 Bài học từ các lần sửa</h1>
        <p className="text-sm" style={{ color: t.textMuted }}>
          Mỗi lần ai đó sửa ảnh, gen lại hay localize lại, lý do được ghi lại. AI gom những lỗi lặp lại thành bài học;
          bài học nào được duyệt sẽ tự thêm vào prompt của các lần gen sau. Bảng dưới cho biết số lần phải sửa có giảm thật không.
        </p>
      </div>

      {error && <div className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: "#EF444414", color: "#EF4444" }}>{error}</div>}
      {note && <div className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: "#7C3AED14", color: "#A78BFA" }}>{note}</div>}

      {/* Did it help: corrections per 100 images, per version */}
      <section className="rounded-2xl border p-5 space-y-3" style={card}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold" style={{ color: t.text }}>Tỉ lệ ảnh phải sửa theo version (90 ngày)</div>
          <button onClick={load} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40" style={{ borderColor: t.border, color: t.textMuted }}>
            {loading ? "⏳" : "↻ Tải lại"}
          </button>
        </div>
        {stats.length === 0 ? (
          <p className="text-sm" style={{ color: t.textMuted }}>{loading ? "Đang đọc log…" : "Chưa có lượt gen ảnh nào trong 90 ngày."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: t.textMuted }}>
                  <th className="py-1.5 pr-3 font-semibold">Version</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Ảnh đã gen</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Lần sửa ảnh</th>
                  <th className="py-1.5 pr-3 font-semibold">Sửa / 100 ảnh</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Localize lại</th>
                  <th className="py-1.5 font-semibold text-right">Lần duyệt nháp</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(s => (
                  <tr key={s.version} className="border-t" style={{ borderColor: t.border, color: t.text }}>
                    <td className="py-1.5 pr-3 font-mono text-xs">v{s.version}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.images}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.imageFixes}</td>
                    <td className="py-1.5 pr-3">
                      {s.per100 === null ? <span style={{ color: t.textMuted }}>—</span> : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded-full" style={{ width: `${Math.max(4, (s.per100 / maxPer100) * 120)}px`, backgroundColor: "#7C3AED" }} />
                          <span className="tabular-nums text-xs">{s.per100}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.relocalize}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.approvals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px]" style={{ color: t.textMuted }}>
          Lần sửa ảnh = sửa 1 ảnh, sửa cả bộ, hoặc gen lại không ghi lý do (không tính gen lại ảnh lỗi kỹ thuật). Số càng thấp càng tốt.
        </p>
      </section>

      {/* Lessons */}
      <section className="rounded-2xl border p-5 space-y-4" style={card}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold" style={{ color: t.text }}>Bài học</div>
            <div className="text-[11px] mt-0.5" style={{ color: t.textMuted }}>
              {canManage ? "Đọc kỹ, sửa câu chữ nếu cần, rồi Áp dụng hoặc Bỏ. Chỉ bài học Áp dụng mới vào prompt." : "Chỉ tài khoản role ua mới duyệt được bài học."}
            </div>
          </div>
          {canManage && (
            <button onClick={propose} disabled={!!busy}
              className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#7C3AED,#EC4899)" }}>
              {busy === "propose" ? "⏳ AI đang đọc các lần sửa…" : "🤖 Tìm bài học mới"}
            </button>
          )}
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {([LESSON_STATUS.pending, LESSON_STATUS.applied, LESSON_STATUS.dropped, "all"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-xs px-3 py-1.5 rounded-lg border"
              style={filter === f ? { borderColor: "#7C3AED", color: "#A78BFA", backgroundColor: "#7C3AED14" } : { borderColor: t.border, color: t.textMuted }}>
              {f === "all" ? `Tất cả (${lessons.length})` : `${f} (${count(f)})`}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm" style={{ color: t.textMuted }}>
            {loading ? "Đang đọc…" : filter === LESSON_STATUS.pending ? "Không có bài học nào chờ duyệt." : "Chưa có bài học nào ở đây."}
          </p>
        ) : (
          <div className="space-y-3">
            {shown.map(l => {
              const draft = drafts[l.id];
              const editable = canManage && l.status !== LESSON_STATUS.dropped;
              const st = STATUS_STYLE[l.status];
              return (
                <div key={l.id} className="rounded-xl border p-3 space-y-2" style={{ borderColor: t.border, backgroundColor: t.tabBg }}>
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="font-semibold px-2 py-0.5 rounded-md" style={{ color: st.color, backgroundColor: st.bg }}>{l.status}</span>
                    {editable ? (
                      <select value={draft?.target ?? l.target}
                        onChange={e => setDrafts(p => ({ ...p, [l.id]: { text: p[l.id]?.text ?? l.text, target: e.target.value as LessonTarget } }))}
                        className="text-[11px] rounded-md px-1.5 py-0.5 border" style={input} aria-label="Áp dụng cho bước">
                        {(Object.keys(LESSON_TARGETS) as LessonTarget[]).map(k => <option key={k} value={k}>{LESSON_TARGETS[k]}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: t.textSub }}>{LESSON_TARGETS[l.target]}</span>
                    )}
                    <span className="font-mono" style={{ color: t.textMuted }}>{l.id}</span>
                    {l.reviewer && <span style={{ color: t.textMuted }}>· {l.reviewer}, {l.reviewedAt}</span>}
                  </div>
                  {editable ? (
                    <textarea value={draft?.text ?? l.text} rows={2} maxLength={300}
                      onChange={e => setDrafts(p => ({ ...p, [l.id]: { target: p[l.id]?.target ?? l.target, text: e.target.value } }))}
                      className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-y" style={input} aria-label="Nội dung bài học" />
                  ) : (
                    <p className="text-sm" style={{ color: t.text }}>{l.text}</p>
                  )}
                  {l.evidence && <p className="text-[11px]" style={{ color: t.textMuted }}>Bằng chứng: {l.evidence}</p>}
                  {canManage && (
                    <div className="flex gap-2 flex-wrap">
                      {l.status !== LESSON_STATUS.applied && (
                        <button onClick={() => review(l, LESSON_STATUS.applied)} disabled={!!busy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40">
                          {busy === l.id ? "⏳" : l.status === LESSON_STATUS.dropped ? "Áp dụng lại" : "✓ Áp dụng"}
                        </button>
                      )}
                      {l.status === LESSON_STATUS.applied && draft && (
                        <button onClick={() => review(l, LESSON_STATUS.applied)} disabled={!!busy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40">
                          {busy === l.id ? "⏳" : "Lưu sửa"}
                        </button>
                      )}
                      {l.status !== LESSON_STATUS.dropped && (
                        <button onClick={() => review(l, LESSON_STATUS.dropped)} disabled={!!busy}
                          className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40" style={{ borderColor: t.border, color: t.textMuted }}>
                          {l.status === LESSON_STATUS.applied ? "Ngừng áp dụng" : "Bỏ"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Latest corrections */}
      <section className="rounded-2xl border p-5 space-y-3" style={card}>
        <div className="font-semibold" style={{ color: t.text }}>Các lần sửa gần đây</div>
        {recent.length === 0 ? (
          <p className="text-sm" style={{ color: t.textMuted }}>{loading ? "Đang đọc…" : "Chưa có lần sửa nào được ghi lại."}</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((f, i) => (
              <li key={i} className="text-sm border-t pt-2 first:border-t-0 first:pt-0" style={{ borderColor: t.border }}>
                <div className="flex gap-2 flex-wrap text-[11px]" style={{ color: t.textMuted }}>
                  <span>{f.time}</span><span>· {f.kind}</span>{f.app && <span>· {f.app}</span>}{f.markets && <span>· {f.markets}</span>}
                  {f.slot && <span className="font-mono">· {f.slot}</span>}<span>· {f.tool}</span>
                </div>
                {f.reason && <div style={{ color: t.text }}>{f.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
