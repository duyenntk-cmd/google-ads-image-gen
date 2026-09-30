"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  createCreatives, dataUrlToFile, getMktClient, makeImageThumbnail, MAX_CREATIVE_SIZE, uploadToS3,
  type CreativeItem, type MktRequestError,
} from "@/lib/mktClient";
import { useMktConnection } from "@/lib/useMktConnection";
import type { MktTheme } from "./MktAdTemplateModal";

export interface CreativeSource { key: string; name: string; dataUrl: string; width: number; height: number; }

type ItemStatus = "idle" | "uploading" | "uploaded" | "error";

const splitList = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

export default function MktUploadCreativeModal({ sources, t, onClose, onDone }: {
  sources: CreativeSource[]; t: MktTheme; onClose: () => void; onDone?: () => void;
}) {
  const conn = useMktConnection();
  const [names, setNames] = useState<string[]>(() => sources.map(s => s.name));
  const [isPublic, setIsPublic] = useState(false);
  const [tags, setTags] = useState("");
  const [productIds, setProductIds] = useState("");
  const [angleCodes, setAngleCodes] = useState("");
  const [marketTargets, setMarketTargets] = useState("");
  const [languages, setLanguages] = useState("");
  const [status, setStatus] = useState<ItemStatus[]>(() => sources.map(() => "idle"));
  const [itemErrors, setItemErrors] = useState<string[]>(() => sources.map(() => ""));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<number | null>(null);

  // Uploaded S3 URLs are kept so a retry only re-sends what failed
  const uploaded = useRef<({ url: string; thumbnail?: string; size: number; type: string } | null)[]>(sources.map(() => null));
  // One Idempotency-Key per bulk body; reused when retrying the same body
  const idem = useRef<{ body: string; key: string } | null>(null);

  const setItem = (i: number, s: ItemStatus, err = "") => {
    setStatus(prev => prev.map((v, j) => (j === i ? s : v)));
    setItemErrors(prev => prev.map((v, j) => (j === i ? err : v)));
  };

  const handleUpload = async () => {
    const mkt = getMktClient();
    if (!mkt) { setError("Chưa kết nối MKT System."); return; }
    setRunning(true); setError("");
    try {
      // 1. Upload files to S3, 3 at a time
      const queue = sources.map((_, i) => i).filter(i => !uploaded.current[i]);
      const worker = async () => {
        for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
          const src = sources[i];
          setItem(i, "uploading");
          try {
            const ext = src.dataUrl.startsWith("data:image/jpeg") ? "jpg" : "png";
            const file = dataUrlToFile(src.dataUrl, `${names[i].trim() || src.key}.${ext}`);
            if (file.size > MAX_CREATIVE_SIZE) throw new Error("File vượt 300 MB");
            const url = await uploadToS3(mkt, file);
            const thumbFile = await makeImageThumbnail(src.dataUrl, file.name);
            const thumbnail = thumbFile ? await uploadToS3(mkt, thumbFile).catch(() => undefined) : undefined;
            uploaded.current[i] = { url, thumbnail, size: file.size, type: file.type };
            setItem(i, "uploaded");
          } catch (e) {
            setItem(i, "error", describeError(e));
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);

      const ready = sources.map((_, i) => i).filter(i => uploaded.current[i]);
      if (ready.length === 0) throw new Error("Không upload được file nào.");
      if (ready.length < sources.length) throw new Error("Một số file upload lỗi. Bấm Upload lại để thử tiếp.");

      // 2. Create the creatives in one bulk request
      const lists = Object.fromEntries(
        Object.entries({ tags, productIds, angleCodes, marketTargets, languages })
          .map(([k, v]) => [k, splitList(v)])
          .filter(([, v]) => v.length > 0)
      ) as Partial<CreativeItem>;
      const items: CreativeItem[] = ready.map(i => {
        const u = uploaded.current[i]!;
        return {
          url: u.url,
          name: names[i].trim() || sources[i].key,
          format: u.type.startsWith("video/") ? "VIDEO" : "IMAGE",
          size: u.size,
          ...(u.thumbnail && { thumbnail: u.thumbnail }),
          isPublic,
          ...lists,
        };
      });
      const body = JSON.stringify(items);
      if (!idem.current || idem.current.body !== body) idem.current = { body, key: crypto.randomUUID() };

      let result: { id: string }[] | null = null;
      for (let attempt = 0; attempt < 5 && !result; attempt++) {
        try {
          result = await createCreatives(mkt, items, idem.current.key);
        } catch (e) {
          const status = (e as MktRequestError).status;
          if (status === 409) { await new Promise(r => setTimeout(r, 2000)); continue; }
          if (status === 422) { idem.current = { body, key: crypto.randomUUID() }; continue; }
          throw e;
        }
      }
      if (!result) throw new Error("Backend đang xử lý request trước đó, thử lại sau ít phút.");
      setCreated(Array.isArray(result) ? result.length : items.length);
      onDone?.();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRunning(false);
    }
  };

  const inputStyle = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text };
  const listFields: [string, string, (v: string) => void, string][] = [
    ["Tags", tags, setTags, "tag1, tag2"],
    ["Product IDs", productIds, setProductIds, "id1, id2"],
    ["Angle codes", angleCodes, setAngleCodes, "ANGLE_1, ANGLE_2"],
    ["Market targets", marketTargets, setMarketTargets, "VN, US"],
    ["Languages", languages, setLanguages, "vi, en"],
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={() => !running && onClose()}>
      <div className="rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-5 border" style={{ backgroundColor: t.card, borderColor: t.border }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="font-bold" style={{ color: t.text }}>⬆ Upload creative lên MKT System</div>
            <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>{sources.length} file được chọn</div>
          </div>
          <button onClick={onClose} disabled={running} className="px-2 py-1 rounded-lg" style={{ color: t.textMuted }}>✕</button>
        </div>

        {!conn ? (
          <div className="rounded-xl border px-4 py-4 text-sm space-y-3" style={{ borderColor: t.border, color: t.text }}>
            <div>Bạn chưa kết nối MKT System.</div>
            <Link href="/mkt-auth" className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-sm px-4 py-2 rounded-lg font-medium">🔗 Kết nối ngay</Link>
          </div>
        ) : created !== null ? (
          <div className="space-y-4">
            <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#10B98155", backgroundColor: "#10B98110", color: "#059669" }}>
              ✓ Đã tạo {created} creative trong thư viện MKT System
            </div>
            <button onClick={onClose} className="w-full bg-violet-600 hover:bg-violet-500 text-white text-sm py-2.5 rounded-xl font-semibold">Đóng</button>
          </div>
        ) : (
          <>
            <div className="text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: t.tabBg, color: t.textMuted }}>
              Tài khoản: <b style={{ color: t.text }}>{conn.email}</b> · hết hạn {new Date(conn.expiresAt).toLocaleString("vi-VN")}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.textMuted }}>Tên hiển thị *</div>
              {sources.map((s, i) => (
                <div key={s.key} className="flex items-center gap-3">
                  <img src={s.dataUrl} alt="" className="w-12 h-12 object-contain rounded border flex-shrink-0" style={{ borderColor: t.border }} />
                  <div className="flex-1 min-w-0">
                    <input value={names[i]} onChange={e => setNames(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
                      disabled={running || status[i] === "uploaded"}
                      className="w-full text-sm rounded-lg px-3 py-1.5 border focus:outline-none focus:border-violet-500" style={inputStyle} />
                    <div className="text-[10px] mt-0.5" style={{ color: status[i] === "error" ? "#EF4444" : t.textMuted }}>
                      {s.width}×{s.height} · {status[i] === "idle" ? "Chờ upload" : status[i] === "uploading" ? "Đang upload..." : status[i] === "uploaded" ? "✓ Đã upload" : `Lỗi: ${itemErrors[i]}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-4 text-sm" style={{ color: t.text }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.textMuted }}>Quyền xem</span>
              <label className="flex items-center gap-1.5"><input type="radio" checked={!isPublic} onChange={() => setIsPublic(false)} disabled={running} /> Private</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={isPublic} onChange={() => setIsPublic(true)} disabled={running} /> Public</label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {listFields.map(([label, value, set, ph]) => (
                <div key={label}>
                  <label className="block text-xs mb-1" style={{ color: t.textMuted }}>{label} <span className="opacity-70">(phân cách bằng dấu phẩy)</span></label>
                  <input value={value} onChange={e => set(e.target.value)} placeholder={ph} disabled={running}
                    className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500" style={inputStyle} />
                </div>
              ))}
            </div>

            {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={running} className="px-4 py-2.5 rounded-xl border text-sm" style={{ borderColor: t.border, color: t.textMuted }}>Huỷ</button>
              <button onClick={handleUpload} disabled={running || names.some(n => !n.trim())}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-semibold">
                {running ? "Đang upload..." : status.some(s => s !== "idle") ? "⬆ Upload lại" : `⬆ Upload ${sources.length} creative`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function describeError(e: unknown): string {
  const err = e as MktRequestError;
  if (err?.status === 403) return "Thiếu quyền Creative Management trong Automate Campaign.";
  if (err?.status === 401) return "Mã kết nối không còn hiệu lực. Lấy mã mới ở MKT System.";
  if (e instanceof TypeError) return "Lỗi mạng hoặc CORS (" + e.message + ").";
  return err?.message || String(e);
}
