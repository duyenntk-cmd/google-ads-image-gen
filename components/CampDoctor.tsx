"use client";
import { useEffect, useState } from "react";
import {
  analyzeAll, joinReports, parseAdsSheet, parseDelimited, parseSystemSheet,
  type CampAnalysis, type Severity, type SystemRow,
} from "@/lib/campDoctor";

export interface CampTheme {
  text: string; textSub: string; textMuted: string; border: string; card: string;
  input: string; inputBorder: string; tabBg: string; tabActive: string; cardShadow: string;
}

const SEV: Record<Severity, { color: string; bg: string; label: string; dot: string }> = {
  bad:  { color: "#EF4444", bg: "#EF444414", label: "Cần xử lý", dot: "🔴" },
  warn: { color: "#F59E0B", bg: "#F59E0B14", label: "Theo dõi", dot: "🟡" },
  good: { color: "#10B981", bg: "#10B98114", label: "Tốt", dot: "🟢" },
  info: { color: "#64748B", bg: "#64748B14", label: "Chưa kết luận", dot: "⚪" },
};

const STORE_KEY = "camp_doctor_urls";
type Source = { url: string; rows: unknown[][] | null; label: string };

const fmt$ = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);

/**
 * Campaign analysis: Google Ads report + system report (est ROAS), joined by
 * campaign name, with the suggested action on each campaign.
 */
export default function CampDoctor({ t, onMakeCreatives }: { t: CampTheme; onMakeCreatives?: () => void }) {
  const [sys, setSys] = useState<Source>({ url: "", rows: null, label: "" });
  const [ads, setAds] = useState<Source>({ url: "", rows: null, label: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<CampAnalysis[] | null>(null);
  const [unmatched, setUnmatched] = useState<SystemRow[]>([]);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [copied, setCopied] = useState("");

  // Last links used, restored after mount (localStorage is not there during server render).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
        if (saved.sys) setSys(s => ({ ...s, url: saved.sys }));
        if (saved.ads) setAds(s => ({ ...s, url: saved.ads }));
      } catch { /* storage blocked */ }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const readSheet = async (url: string) => {
    const res = await fetch("/api/camp-sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || `HTTP ${res.status}`);
    return { rows: d.rows as unknown[][], label: `${d.title} · ${d.sheet}` };
  };

  const onFile = (which: "sys" | "ads") => async (f: File | undefined) => {
    if (!f) return;
    const rows = parseDelimited(await f.text());
    (which === "sys" ? setSys : setAds)(s => ({ ...s, rows, label: `📄 ${f.name}` }));
  };

  const run = async () => {
    setBusy(true); setError("");
    try {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ sys: sys.url, ads: ads.url })); } catch {}
      // A pasted link wins over an uploaded file, so a fresh link is always re-read.
      const [s, a] = await Promise.all([
        sys.url.trim() ? readSheet(sys.url.trim()) : Promise.resolve(sys.rows ? { rows: sys.rows, label: sys.label } : null),
        ads.url.trim() ? readSheet(ads.url.trim()) : Promise.resolve(ads.rows ? { rows: ads.rows, label: ads.label } : null),
      ]);
      if (!s) throw new Error("Thiếu file data system (dán link hoặc upload CSV).");
      if (!a) throw new Error("Thiếu file data GG Ads (dán link hoặc upload CSV).");
      setSys(x => ({ ...x, label: s.label })); setAds(x => ({ ...x, label: a.label }));
      const sysRows = parseSystemSheet(s.rows), adsRows = parseAdsSheet(a.rows);
      const joined = joinReports(adsRows, sysRows);
      setResults(analyzeAll(joined));
      const adsNames = new Set(joined.map(j => j.name.replace(/\s+/g, " ").trim().toLowerCase()));
      setUnmatched(sysRows.filter(r => !adsNames.has(r.name.replace(/\s+/g, " ").trim().toLowerCase())));
    } catch (e) {
      setError("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  };

  const inputStyle = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text };
  const cardStyle = { backgroundColor: t.card, borderColor: t.border, boxShadow: t.cardShadow };

  // Summary over what was joined
  const summary = results && (() => {
    const rows = results.map(r => r.row);
    const cost = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
    const sysSpend = rows.reduce((a, r) => a + (r.sysSpend ?? 0), 0);
    const estRev = rows.reduce((a, r) => a + (r.sysEstRevenue ?? 0), 0);
    const count = (s: Severity) => results.filter(r => r.health === s).length;
    const actions = results.reduce((a, r) => a + r.suggestions.filter(s => s.to !== undefined || s.kind === "assets" || s.kind === "creative").length, 0);
    return { cost, sysSpend, estRev, estRoas: sysSpend ? estRev / sysSpend : null, bad: count("bad"), warn: count("warn"), good: count("good"), info: count("info"), actions };
  })();

  const shown = (results || []).filter(r => filter === "all" || r.health === filter);

  const sourceBox = (title: string, hint: string, src: Source, set: typeof setSys, which: "sys" | "ads") => (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold" style={{ color: t.text }}>{title}</div>
      <div className="text-[11px]" style={{ color: t.textMuted }}>{hint}</div>
      <input value={src.url} onChange={e => set(s => ({ ...s, url: e.target.value }))}
        placeholder="https://docs.google.com/spreadsheets/d/...#gid=..."
        className="w-full text-xs rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500" style={inputStyle} />
      <div className="flex items-center gap-2 text-[11px]" style={{ color: t.textMuted }}>
        <span>hoặc upload CSV:</span>
        <input type="file" accept=".csv,.tsv,text/csv" onChange={e => onFile(which)(e.target.files?.[0])} className="text-[11px]" />
      </div>
      {src.label && <div className="text-[11px]" style={{ color: "#10B981" }}>✓ {src.label}</div>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
        <div>
          <div className="text-sm font-bold" style={{ color: t.text }}>📊 Phân tích campaign & gợi ý action</div>
          <div className="text-[11px] mt-0.5" style={{ color: t.textMuted }}>
            Ghép report GG Ads với data system theo <b>tên campaign</b>; dùng <b>est_roas</b> của system so với <b>target ROAS</b> trên GG Ads.
            Mỗi lần chỉnh tối đa ~20%, camp đang learning thì không chỉnh — theo khuyến nghị của Google cho App campaign.
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {sourceBox("1. File data GG Ads", "Report campaign export từ Google Ads (Campaign, Budget, Status reasons, Avg. target ROAS, Cost...)", ads, setAds, "ads")}
          {sourceBox("2. File data system", "Report có campaign_name và est_roas", sys, setSys, "sys")}
        </div>
        <div className="text-[11px]" style={{ color: t.textMuted }}>
          Đọc bằng link: file phải được share quyền xem cho service account của web (nếu chưa, lỗi sẽ hiện đúng email cần share).
        </div>
        {error && <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{error}</p>}
        <button onClick={run} disabled={busy}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: "linear-gradient(135deg,#7C3AED,#EC4899)" }}>
          {busy ? "⏳ Đang đọc & phân tích..." : results ? "↻ Phân tích lại" : "📊 Phân tích"}
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Cost GG Ads", fmt$(summary.cost)],
            ["Spend (system)", fmt$(summary.sysSpend)],
            ["Est revenue d0", fmt$(summary.estRev)],
            ["Est ROAS tổng", fmtPct(summary.estRoas)],
          ].map(([k, v]) => (
            <div key={k} className="p-3 border rounded-xl" style={cardStyle}>
              <div className="text-[11px]" style={{ color: t.textMuted }}>{k}</div>
              <div className="text-lg font-bold" style={{ color: t.text }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(["all", "bad", "warn", "good", "info"] as const).map(f => {
            const n = f === "all" ? results!.length : summary[f];
            const on = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded-lg border"
                style={{ borderColor: on ? "#7C3AED" : t.border, backgroundColor: on ? "#7C3AED14" : "transparent", color: on ? "#A78BFA" : t.textMuted }}>
                {f === "all" ? `Tất cả (${n})` : `${SEV[f].dot} ${SEV[f].label} (${n})`}
              </button>
            );
          })}
          <span className="ml-auto" style={{ color: t.textMuted }}>{summary.actions} action được gợi ý</span>
        </div>
      )}

      {shown.map(a => {
        const r = a.row, sev = SEV[a.health];
        const used = r.cost !== null && r.budget ? r.cost / r.budget : null;
        return (
          <div key={r.name} className="p-4 border rounded-2xl space-y-3" style={{ ...cardStyle, borderColor: sev.color + "55" }}>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0">{sev.dot}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold break-all" style={{ color: t.text }}>{r.name}</span>
                  <button onClick={() => copy(r.name, `n-${r.name}`)} title="Chép tên campaign" className="text-[10px] flex-shrink-0" style={{ color: t.textMuted }}>
                    {copied === `n-${r.name}` ? "✓" : "⧉"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: t.tabBg, color: t.textSub }}>{r.status || "—"}</span>
                  {r.statusReasons.split(";").map(x => x.trim()).filter(Boolean).map(x => (
                    <span key={x} className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F59E0B14", color: "#F59E0B" }}>{x}</span>
                  ))}
                  {r.campaignId && <span className="text-[10px] px-2 py-0.5" style={{ color: t.textMuted }}>ID {r.campaignId}</span>}
                </div>
              </div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: sev.bg, color: sev.color }}>{sev.label}</span>
            </div>

            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
              {[
                ["Est ROAS", fmtPct(r.estRoas), a.ratio !== null ? (a.ratio >= 1 ? "#10B981" : a.ratio >= 0.8 ? "#F59E0B" : "#EF4444") : t.text],
                ["Target ROAS", fmtPct(r.tRoas), t.text],
                ["GG ROAS", fmtPct(r.gRoas), t.textSub],
                ["Budget / ngày", fmt$(r.budget), t.text],
                ["Cost", `${fmt$(r.cost)}${used !== null ? ` · ${Math.round(used * 100)}%` : ""}`, t.text],
                ["Install (MMP) · CPI", `${r.installs ?? "—"} · ${fmt$(r.cpi)}`, t.text],
              ].map(([k, v, c]) => (
                <div key={k} className="rounded-lg px-2 py-1.5" style={{ backgroundColor: t.tabBg }}>
                  <div className="text-[10px]" style={{ color: t.textMuted }}>{k}</div>
                  <div className="font-semibold" style={{ color: c }}>{v}</div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              {a.suggestions.map((s, i) => {
                const c = SEV[s.severity];
                const key = `${r.name}-${i}`;
                return (
                  <div key={i} className="rounded-lg px-3 py-2 flex items-start gap-3" style={{ backgroundColor: c.bg }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold" style={{ color: c.color }}>{s.title}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: t.textSub }}>{s.detail}</div>
                    </div>
                    {s.to !== undefined && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs whitespace-nowrap" style={{ color: t.text }}>
                          <span style={{ color: t.textMuted, textDecoration: "line-through" }}>{s.unit === "$" ? `$${s.from}` : `${s.from}%`}</span>
                          {" → "}<b>{s.unit === "$" ? `$${s.to}` : `${s.to}%`}</b>
                        </span>
                        <button onClick={() => copy(String(s.to), key)} title="Chép giá trị mới để dán vào Google Ads"
                          className="text-[11px] font-semibold px-2 py-1 rounded-md text-white" style={{ backgroundColor: c.color }}>
                          {copied === key ? "✓ Đã chép" : "Chép"}
                        </button>
                      </div>
                    )}
                    {(s.kind === "assets" || s.kind === "creative") && onMakeCreatives && (
                      <button onClick={onMakeCreatives} className="text-[11px] font-semibold px-2 py-1 rounded-md text-white flex-shrink-0" style={{ backgroundColor: "#7C3AED" }}>
                        🎨 Tạo asset mới
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {unmatched.length > 0 && (
        <div className="p-4 border rounded-2xl text-[11px] space-y-1" style={cardStyle}>
          <div className="font-semibold" style={{ color: t.textSub }}>Có trong data system nhưng không có trong report GG Ads ({unmatched.length})</div>
          {unmatched.map(u => <div key={u.name} style={{ color: t.textMuted }}>• {u.name} {u.campaignId && `(${u.campaignId})`}</div>)}
          <div style={{ color: t.textMuted }}>Thường là camp đã tạm dừng hoặc không nằm trong khoảng ngày của report GG Ads.</div>
        </div>
      )}
    </div>
  );
}
