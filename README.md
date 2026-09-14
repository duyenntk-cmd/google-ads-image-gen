# Google Ads Banner Generator

Gen banner Google Ads tự động từ **URL App Store / Play Store** bằng AI.

**Pipeline:** URL → fetch app info + screenshots → GPT-4o phân tích tạo design brief → gpt-image-1 gen 3 ảnh base (portrait / square / landscape) song song → ghép branding bar + icon thật (Canvas) → resize ra 8 kích thước chuẩn Google Ads → xuất ZIP.

## Chạy local

```bash
npm install
cp .env.example .env.local      # rồi điền OPENAI_API_KEY
npm run dev                      # http://localhost:3000
```

## Environment variable

| Key | Bắt buộc | Dùng cho |
|-----|----------|----------|
| `OPENAI_API_KEY` | ✅ | gpt-image-1 (ảnh) + gpt-4o-mini (brief / creative direction) |

Không hardcode key trong code. Set trong Vercel: **Settings → Environment Variables**.

## Deploy Vercel

1. Push repo lên GitHub (`duyenntk-cmd`).
2. Vercel → New Project → import repo.
3. Thêm env var `OPENAI_API_KEY`.
4. Deploy.

> ⚠️ **maxDuration & gpt-image-1:** route `/api/banner-generate` để `maxDuration = 300` vì gpt-image-1 mất ~30–60s/ảnh.
> - **Vercel Pro/Enterprise:** OK (tới 300s).
> - **Vercel Hobby (free):** bị giới hạn **60s** → dễ timeout ở quality `high`. Trên Hobby nên dùng quality `low`/`medium`, hoặc sửa `maxDuration = 60` trong `app/api/banner-generate/route.ts`.

## 8 kích thước Google Ads

| Size | Loại | Dùng cho |
|------|------|----------|
| 1200×628 | landscape | Google UAC + Display |
| 1200×1200 | square | Google UAC + Display |
| 1080×1920 | portrait | Google UAC Stories |
| 300×250 | square | Display (phổ biến nhất) |
| 336×280 | square | Display |
| 728×90 | landscape | Leaderboard |
| 300×600 | portrait | Half Page |
| 320×50 | landscape | Mobile Banner |

gpt-image-1 chỉ gen được 3 tỷ lệ gốc (1024×1536, 1024×1024, 1536×1024); 5 size còn lại được resize client-side từ ảnh base phù hợp nhất (stretch nếu tỷ lệ gần giống, blur-extend + contain nếu khác xa để không crop nội dung).

## Cấu trúc

```
app/
├── page.tsx                      # UI + composite + resize + ZIP (client)
├── layout.tsx  globals.css
└── api/
    ├── screenshots/route.ts      # iTunes lookup (iOS) + google-play-scraper (Android)
    ├── auto-prompt/route.ts      # gpt-4o-mini → creative direction (VI)
    ├── banner-concept/route.ts   # gpt-4o-mini → design brief JSON
    └── banner-generate/route.ts  # gpt-image-1 → base image (1 ratio/request)
lib/
└── adSizes.ts                    # 8 sizes + pickBaseRatio()
```

## Ghi chú kỹ thuật

- **Mascot tự động (không cần upload):** route `/api/mascot` chạy trước khi gen — GPT-4o Vision tìm nhân vật trong screenshots của app; có → dùng screenshot đó làm reference; không có → gpt-image-1 tự tạo 1 mascot từ mô tả app rồi **tái dùng đúng con đó** cho cả 3 tỷ lệ (nhất quán). Vẫn có thể upload ảnh mascot để ghi đè auto.
- **AI KHÔNG vẽ chữ:** prompt cấm tuyệt đối text/số/logo. gpt-image-1 chỉ dựng scene + phone mockup. Toàn bộ headline / subheadline / CTA được **overlay bằng Canvas** sau đó → nét căng, đúng màu brand, và **tiếng Việt có dấu không bị vỡ** (dùng font hệ thống). Text được vẽ theo từng size cuối (banner nhỏ như 320×50/728×90 rút gọn còn headline 1 dòng + nút CTA).
- **Screenshot thật (branding chính xác):** khi bật toggle "Dùng screenshot thật", route `/api/banner-generate` gọi `images.edit` (gpt-image-1) với screenshot thật của app → điện thoại trong ảnh hiển thị đúng UI app, không còn UI bịa. Tắt toggle → quay lại `images.generate` (phone UI generic, nhanh hơn một chút).
- **Branding bar:** phủ dark bar lên top 10% canvas rồi ghép **icon thật** + app name (Canvas), vì AI hay vẽ icon fake.
- **TOP ZONE rule:** prompt luôn yêu cầu top 10% để trống (dark strip) cho branding bar; và chừa vùng dưới sạch cho text overlay.
- **Parallel gen:** client gọi 3 request song song, mỗi request 1 ratio, tránh timeout khi gen tuần tự.
- **safeJson():** parse an toàn phòng khi API trả HTML error page thay vì JSON.
- `google-play-scraper` là package server-only (đã khai báo trong `serverComponentsExternalPackages`).
