"use client";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

/** Same rule as PASSWORD_MIN in lib/sheetsUsers.ts (the server checks again). */
const MIN = 8;

export interface PasswordTheme {
  text: string; textMuted: string; border: string; card: string; input: string; inputBorder: string; tabBg: string;
}

/**
 * The signed-in person changes their own password (POST /api/account/password).
 * On success every session ends, this one right away: the person signs in
 * again with the new password.
 */
export default function ChangePasswordModal({ t, onClose }: { t: PasswordTheme; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy && !done) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, done, onClose]);

  const problem =
    !current || !next || !confirm ? "" :
    next.length < MIN ? `Mật khẩu mới cần ít nhất ${MIN} ký tự.` :
    next === current ? "Mật khẩu mới phải khác mật khẩu hiện tại." :
    next !== confirm ? "Hai ô mật khẩu mới chưa giống nhau." : "";
  const ready = Boolean(current && next && confirm) && !problem;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `Lỗi ${res.status}`);
      setDone(true);
      setTimeout(() => { void signOut({ callbackUrl: "/login?pw=changed" }); }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const inputStyle = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text };
  const field = (label: string, value: string, set: (v: string) => void, autoComplete: string, autoFocus = false) => (
    <label className="block space-y-1">
      <span className="text-xs font-semibold" style={{ color: t.textMuted }}>{label}</span>
      <input type={show ? "text" : "password"} value={value} onChange={e => set(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus}
        disabled={busy || done} className="w-full text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500 disabled:opacity-60" style={inputStyle} />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={() => { if (!busy && !done) onClose(); }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pw-title"
        className="rounded-2xl p-6 max-w-md w-full space-y-4 border"
        style={{ backgroundColor: t.card, borderColor: t.border, boxShadow: "0 25px 80px rgba(0,0,0,0.4)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div id="pw-title" className="font-bold" style={{ color: t.text }}>🔑 Đổi mật khẩu</div>
            <div className="text-[11px] mt-0.5" style={{ color: t.textMuted }}>
              Ít nhất {MIN} ký tự. Đổi xong, bạn được đăng xuất ở mọi nơi và đăng nhập lại bằng mật khẩu mới.
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy || done} aria-label="Đóng" className="px-2 py-1 rounded-lg disabled:opacity-40" style={{ color: t.textMuted }}>✕</button>
        </div>

        {done ? (
          <div className="text-sm px-3 py-3 rounded-xl" style={{ backgroundColor: "#10B98118", color: "#10B981" }}>
            ✓ Đã đổi mật khẩu. Đang đăng xuất để bạn đăng nhập lại…
          </div>
        ) : (
          <>
            {field("Mật khẩu hiện tại", current, setCurrent, "current-password", true)}
            {field("Mật khẩu mới", next, setNext, "new-password")}
            {field("Nhập lại mật khẩu mới", confirm, setConfirm, "new-password")}
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: t.textMuted }}>
              <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Hiện mật khẩu
            </label>
            {(problem || error) && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: "#EF444414", color: "#EF4444" }}>{error || problem}</div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm border disabled:opacity-40"
                style={{ borderColor: t.border, color: t.textMuted, backgroundColor: t.tabBg }}>Huỷ</button>
              <button type="submit" disabled={!ready || busy}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40">
                {busy ? "⏳ Đang lưu" : "Đổi mật khẩu"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
