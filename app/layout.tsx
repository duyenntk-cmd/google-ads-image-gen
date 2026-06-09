import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Google Ads Generator — App Mobile",
  description: "Tạo ảnh Google Display Ads tự động từ video quảng cáo app mobile",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
