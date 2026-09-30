"use client";
import Link from "next/link";
import { useState } from "react";
import { clearConnection, createMktClient, parseConnectCode, saveConnection } from "@/lib/mktClient";
import { useMktConnection } from "@/lib/useMktConnection";

export default function MktAuthPage() {
  const conn = useMktConnection();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bg = "#F8FAFC";
  const card = "#FFFFFF";
  const text = "#0F172A";
  const textMuted = "#475569";
  const border = "#E2E8F0";
  const inputBg = "#F8FAFC";

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const parsed = parseConnectCode(code);
      // Exchange the refresh token once to make sure the code actually works
      await createMktClient(parsed).getAccessToken();
      saveConnection(parsed);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    clearConnection();
    setError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: bg, fontFamily: "Inter,-apple-system,sans-serif" }}>
      <div className="relative z-10 w-full max-w-lg px-6">
        <div className="rounded-2xl border p-8 space-y-6" style={{ backgroundColor: card, borderColor: border, boxShadow: "0 4px 24px rgba(109,40,217,0.07)" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold" style={{ color: text }}>🔗 Kết nối MKT System</div>
              <div className="text-xs mt-1" style={{ color: textMuted }}>
                Dùng để upload creative và tạo ad template Google thay cho tài khoản MKT của bạn
              </div>
            </div>
            <Link href="/" className="text-xs px-3 py-1.5 rounded-md border" style={{ color: textMuted, borderColor: border }}>
              ← Về app
            </Link>
          </div>

          {conn ? (
            <div className="space-y-4">
              <div className="rounded-xl border px-4 py-3" style={{ borderColor: "#10B98155", backgroundColor: "#10B98110" }}>
                <div className="text-sm font-semibold" style={{ color: "#059669" }}>✓ Đã kết nối: {conn.email || "(không rõ email)"}</div>
                <div className="text-xs mt-1" style={{ color: textMuted }}>
                  Hết hạn lúc {new Date(conn.expiresAt).toLocaleString("vi-VN")}
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: textMuted }}>
                Kiểm tra đúng email của bạn. Mã không gia hạn được — hết hạn thì đăng nhập lại MKT System và lấy mã mới.
              </p>
              <button onClick={handleDisconnect}
                className="w-full text-sm py-2.5 rounded-xl border font-medium"
                style={{ borderColor: "#FCA5A5", color: "#DC2626" }}>
                Ngắt kết nối
              </button>
              <p className="text-[11px] leading-relaxed" style={{ color: textMuted }}>
                Ngắt kết nối chỉ xoá mã khỏi trình duyệt này. Token vẫn còn hiệu lực tới khi hết hạn.
                Nếu nghi mã bị lộ, báo ngay cho team MKT System.
              </p>
            </div>
          ) : (
            <form onSubmit={handleConnect} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: textMuted }}>Mã kết nối</label>
                <textarea value={code} onChange={e => setCode(e.target.value)} rows={4}
                  placeholder="mktmcp_..."
                  autoComplete="off" spellCheck={false}
                  className="w-full rounded-xl px-4 py-3 text-xs font-mono border focus:outline-none focus:border-violet-500 resize-none"
                  style={{ backgroundColor: inputBg, borderColor: border, color: text }} />
                <p className="text-[11px] mt-1.5" style={{ color: textMuted }}>
                  Lấy mã ở trang Profile của MKT System (nút <b>Kết nối Claude</b>). Mã chỉ lưu trong tab này (sessionStorage).
                </p>
              </div>
              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading || !code.trim()}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-3 rounded-xl font-semibold">
                {loading ? "Đang kiểm tra..." : "Kết nối"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
