import { NextResponse } from "next/server";

// Outro Studio → MKT system.
// GET: cho trang biết đã cấu hình kết nối chưa (không bao giờ trả key về trình duyệt).
// Phần upload thật sẽ thêm khi có tài liệu API của MKT system; key đặt trong
// Vercel → Settings → Environment Variables (MKT_API_URL, MKT_API_KEY, MKT_OPEN_URL).

export async function GET() {
  return NextResponse.json(
    {
      configured: Boolean(process.env.MKT_API_URL && process.env.MKT_API_KEY),
      openUrl: process.env.MKT_OPEN_URL || null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
