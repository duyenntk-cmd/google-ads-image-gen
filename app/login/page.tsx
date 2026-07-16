"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const email = params.get("email");

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F8FAFC", fontFamily: "Inter,-apple-system,sans-serif" }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center mb-4 shadow-lg">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="5" rx="1" fill="white" opacity="0.9"/>
              <rect x="9" y="1" width="6" height="8" rx="1" fill="white" opacity="0.6"/>
              <rect x="1" y="8" width="6" height="7" rx="1" fill="white" opacity="0.6"/>
              <rect x="9" y="11" width="6" height="4" rx="1" fill="white" opacity="0.4"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Ads Generator</h1>
          <p className="text-sm text-slate-500 mt-1">Apero Group — Internal Tool</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-1">Đăng nhập</h2>
          <p className="text-sm text-slate-500 mb-6">Dùng tài khoản Google được cấp quyền</p>

          {/* Error messages */}
          {error === "not_allowed" && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
              Email <strong>{email}</strong> chưa được cấp quyền truy cập.
            </div>
          )}
          {error && error !== "not_allowed" && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
              Đăng nhập thất bại. Vui lòng thử lại.
            </div>
          )}

          <a href="/api/auth/login"
            className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700 shadow-sm">
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Đăng nhập với Google
          </a>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Chỉ tài khoản được cấp quyền mới đăng nhập được
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
