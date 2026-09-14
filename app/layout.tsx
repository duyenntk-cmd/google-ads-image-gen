import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Google Ads Banner Generator",
  description: "Gen banner Google Ads tự động từ URL App Store / Play Store bằng AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-[#0b0b14] text-slate-100 antialiased">{children}</body>
    </html>
  );
}
