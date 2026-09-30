"use client";
import Link from "next/link";
import { useState } from "react";
import { AD_LIMITS, createGoogleAdTemplate, getMktClient, validateAdBlock, type AdContentBlock, type MktRequestError } from "@/lib/mktClient";
import { useMktConnection } from "@/lib/useMktConnection";

export interface MktTheme {
  text: string; textMuted: string; border: string; card: string;
  input: string; inputBorder: string; tabBg: string;
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Splits the selected copy into blocks of ≤5 headlines; every block gets descriptions. */
function buildBlocks(headlines: string[], descriptions: string[]): AdContentBlock[] {
  const hChunks = chunk(headlines, AD_LIMITS.maxPerBlock);
  const dChunks = chunk(descriptions, AD_LIMITS.maxPerBlock);
  const n = Math.max(hChunks.length, dChunks.length, 1);
  return Array.from({ length: n }, (_, i) => ({
    headlines: hChunks[i] ?? [],
    descriptions: dChunks[i] ?? dChunks[i % Math.max(dChunks.length, 1)] ?? [],
  }));
}

const lines = (s: string) => s.split("\n");

export default function MktAdTemplateModal({ headlines, descriptions, defaultName, t, onClose }: {
  headlines: string[]; descriptions: string[]; defaultName: string; t: MktTheme; onClose: () => void;
}) {
  const conn = useMktConnection();
  const [name, setName] = useState(defaultName);
  const [blocks, setBlocks] = useState<{ h: string; d: string }[]>(() =>
    buildBlocks(headlines, descriptions).map(b => ({ h: b.headlines.join("\n"), d: b.descriptions.join("\n") }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  const parsed: AdContentBlock[] = blocks.map(b => ({
    headlines: lines(b.h).map(x => x.trim()).filter(Boolean),
    descriptions: lines(b.d).map(x => x.trim()).filter(Boolean),
  }));
  const blockErrors = parsed.map(validateAdBlock);
  const valid = name.trim() && parsed.length > 0 && blockErrors.every(e => e.length === 0);

  const updateBlock = (i: number, patch: Partial<{ h: string; d: string }>) =>
    setBlocks(prev => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const handleSave = async () => {
    const mkt = getMktClient();
    if (!mkt) { setError("Chưa kết nối MKT System."); return; }
    setSaving(true); setError("");
    try {
      const tpl = await createGoogleAdTemplate(mkt, name.trim(), parsed);
      setCreated({ id: tpl.id, name: tpl.name });
    } catch (e) {
      const err = e as MktRequestError;
      setError(err.status === 401 ? "Mã kết nối không còn hiệu lực. Lấy mã mới ở MKT System." : err.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text };
  const counter = (text: string, max: number) => (
    <div className="text-[10px] mt-0.5 space-x-2" style={{ color: t.textMuted }}>
      {lines(text).map(x => x.trim()).filter(Boolean).map((x, k) => (
        <span key={k} style={{ color: x.length > max ? "#EF4444" : undefined }}>#{k + 1}: {x.length}/{max}</span>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={() => !saving && onClose()}>
      <div className="rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-5 border" style={{ backgroundColor: t.card, borderColor: t.border }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="font-bold" style={{ color: t.text }}>📋 Tạo ad template Google</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>Mỗi khối: 2–5 headline khác nhau (≤30 ký tự), 1–5 description (≤90 ký tự)</div>
          </div>
          <button onClick={onClose} disabled={saving} className="px-2 py-1 rounded-lg" style={{ color: t.textMuted }}>✕</button>
        </div>

        {!conn ? (
          <div className="rounded-xl border px-4 py-4 text-sm space-y-3" style={{ borderColor: t.border, color: t.text }}>
            <div>Bạn chưa kết nối MKT System.</div>
            <Link href="/mkt-auth" className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-sm px-4 py-2 rounded-lg font-medium">🔗 Kết nối ngay</Link>
          </div>
        ) : created ? (
          <div className="space-y-4">
            <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#10B98155", backgroundColor: "#10B98110", color: "#059669" }}>
              ✓ Đã tạo template “{created.name}” (id: {created.id})
            </div>
            <button onClick={onClose} className="w-full bg-violet-600 hover:bg-violet-500 text-white text-sm py-2.5 rounded-xl font-semibold">Đóng</button>
          </div>
        ) : (
          <>
            <div className="text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: t.tabBg, color: t.textMuted }}>
              Tài khoản: <b style={{ color: t.text }}>{conn.email}</b> · hết hạn {new Date(conn.expiresAt).toLocaleString("vi-VN")}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: t.textMuted }}>Tên template *</label>
              <input value={name} onChange={e => setName(e.target.value)} disabled={saving}
                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500" style={inputStyle} />
            </div>

            {blocks.map((b, i) => (
              <div key={i} className="rounded-xl border p-4 space-y-3" style={{ borderColor: blockErrors[i].length ? "#EF444466" : t.border }}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold" style={{ color: t.text }}>Khối {i + 1}</div>
                  {blocks.length > 1 && (
                    <button onClick={() => setBlocks(prev => prev.filter((_, j) => j !== i))} disabled={saving}
                      className="text-[11px]" style={{ color: "#EF4444" }}>Xoá khối</button>
                  )}
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: t.textMuted }}>Headlines (mỗi dòng 1 headline)</label>
                  <textarea value={b.h} onChange={e => updateBlock(i, { h: e.target.value })} rows={4} disabled={saving}
                    className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-y" style={inputStyle} />
                  {counter(b.h, AD_LIMITS.headlineMax)}
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: t.textMuted }}>Descriptions (mỗi dòng 1 description)</label>
                  <textarea value={b.d} onChange={e => updateBlock(i, { d: e.target.value })} rows={3} disabled={saving}
                    className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-y" style={inputStyle} />
                  {counter(b.d, AD_LIMITS.descriptionMax)}
                </div>
                {blockErrors[i].length > 0 && (
                  <div className="text-[11px] text-red-400">⚠ {blockErrors[i].join(" · ")}</div>
                )}
              </div>
            ))}

            <button onClick={() => setBlocks(prev => [...prev, { h: "", d: "" }])} disabled={saving}
              className="w-full text-xs py-2 rounded-xl border border-dashed" style={{ borderColor: t.border, color: t.textMuted }}>
              + Thêm khối
            </button>

            {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-xl border text-sm" style={{ borderColor: t.border, color: t.textMuted }}>Huỷ</button>
              <button onClick={handleSave} disabled={saving || !valid}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-semibold">
                {saving ? "Đang tạo..." : "Tạo template"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
