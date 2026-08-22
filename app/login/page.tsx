"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [credLoading, setCredLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const bg = "#F8FAFC";
  const card = "#FFFFFF";
  const text = "#0F172A";
  const textMuted = "#475569";
  const border = "#E2E8F0";
  const inputBg = "#F8FAFC";

  const handleKeycloakLogin = async () => {
    setLoading(true);
    await signIn("keycloak", { callbackUrl: "/" });
  };

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setCredLoading(true);
    setError("");
    const res = await signIn("credentials", {
      username: username.trim(),
      password,
      callbackUrl: "/",
      redirect: false,
    });
    if (res?.error) {
      setError("Sai username hoặc mật khẩu");
      setCredLoading(false);
    } else if (res?.url) {
      window.location.href = res.url;
    } else {
      setCredLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: bg, fontFamily: "Inter,-apple-system,sans-serif" }}>
      {/* Gradient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-10%", right: "5%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)", filter: "blur(40px)" }} />
        <div style={{ position: "absolute", bottom: "10%", left: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(236,72,153,0.05) 0%, transparent 70%)", filter: "blur(40px)" }} />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="rounded-2xl border p-8 shadow-xl space-y-6" style={{ backgroundColor: card, borderColor: border, boxShadow: "0 4px 24px rgba(109,40,217,0.07)" }}>
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="6" height="5" rx="1" fill="white" opacity="0.9"/>
                <rect x="9" y="1" width="6" height="8" rx="1" fill="white" opacity="0.6"/>
                <rect x="1" y="8" width="6" height="7" rx="1" fill="white" opacity="0.6"/>
                <rect x="9" y="11" width="6" height="4" rx="1" fill="white" opacity="0.4"/>
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold" style={{ color: text }}>Ads Generator</div>
              <div className="text-xs" style={{ color: textMuted }}>Apero Group</div>
            </div>
          </div>

          <div>
            <h1 className="text-xl font-bold mb-1" style={{ color: text }}>Đăng nhập</h1>
            <p className="text-sm" style={{ color: textMuted }}>Chọn phương thức đăng nhập</p>
          </div>

          {/* Credentials form */}
          <form onSubmit={handleCredentialsLogin} className="space-y-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: textMuted }}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(""); }}
                placeholder="Nhập username"
                autoComplete="username"
                className="w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none transition-all"
                style={{ backgroundColor: inputBg, borderColor: error ? "#EF4444" : border, color: text }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: textMuted }}>Mật khẩu</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="Nhập mật khẩu"
                  autoComplete="current-password"
                  className="w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none transition-all pr-10"
                  style={{ backgroundColor: inputBg, borderColor: error ? "#EF4444" : border, color: text }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                  style={{ color: textMuted }}>
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            {error && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: "#EF444415", color: "#EF4444" }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={credLoading || !username.trim() || !password}
              className="w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              style={{ backgroundColor: "#7C3AED", color: "white" }}>
              {credLoading ? "⏳ Đang đăng nhập..." : "Đăng nhập"}
            </button>
          </form>

          <p className="text-xs text-center" style={{ color: textMuted }}>
            Liên hệ admin để được cấp tài khoản
          </p>
        </div>
      </div>
    </div>
  );
}
