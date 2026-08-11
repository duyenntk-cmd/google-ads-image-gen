"use client";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [darkMode] = useState(false);
  const bg = darkMode ? "#0A0A0F" : "#F8FAFC";
  const card = darkMode ? "#0F1117" : "#FFFFFF";
  const text = darkMode ? "#F1F5F9" : "#0F172A";
  const textMuted = darkMode ? "#94A3B8" : "#475569";
  const border = darkMode ? "#1E293B" : "#E2E8F0";

  useEffect(() => {
    // Check if already authenticated, redirect handled by middleware
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    await signIn("keycloak", { callbackUrl: "/" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: bg, fontFamily: "Inter,-apple-system,sans-serif" }}>
      {/* Gradient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-10%", right: "5%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)", filter: "blur(40px)" }} />
        <div style={{ position: "absolute", bottom: "10%", left: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(236,72,153,0.05) 0%, transparent 70%)", filter: "blur(40px)" }} />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="rounded-2xl border p-8 shadow-xl" style={{ backgroundColor: card, borderColor: border, boxShadow: "0 4px 24px rgba(109,40,217,0.07)" }}>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
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

          <h1 className="text-xl font-bold mb-1" style={{ color: text }}>Đăng nhập</h1>
          <p className="text-sm mb-8" style={{ color: textMuted }}>Dùng tài khoản Apero để truy cập công cụ</p>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-semibold text-sm transition-all disabled:opacity-60"
            style={{ backgroundColor: "#7C3AED", color: "white" }}
          >
            {loading ? (
              <><span className="animate-spin">⏳</span> Đang chuyển hướng...</>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" opacity="0.4"/>
                  <path d="M12 6v6l4 2" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Đăng nhập với Apero SSO
              </>
            )}
          </button>

          <p className="text-xs text-center mt-4" style={{ color: textMuted }}>
            Chỉ tài khoản Apero Group mới có thể đăng nhập
          </p>
        </div>
      </div>
    </div>
  );
}
