# Kiến trúc & quy ước code

Repo: `duyenntk-cmd/google-ads-image-gen` · Next.js App Router · TypeScript · Tailwind ·
deploy Vercel · đăng nhập NextAuth (Google).

## Biến môi trường (chỉ đặt trên Vercel, không bao giờ trong code)

| Biến | Dùng cho |
|---|---|
| `OPENAI_API_KEY` | gen ảnh, brief, mascot, revise, localize banner |
| `ANTHROPIC_API_KEY` | Ad Copy Studio: keyword, ad copy, localize copy |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | đăng nhập + YouTube |
| `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` | OAuth Google Ads |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API |
| `GOOGLE_ADS_MCC_CUSTOMER_ID` | tài khoản MCC |
| `NEXTAUTH_URL` | URL gốc, dùng dựng redirect URI |

## API route

| Route | Việc |
|---|---|
| `/api/screenshots` | lấy tên app, mô tả, screenshot, icon từ Play/App Store |
| `/api/auto-prompt` | viết creative direction |
| `/api/banner-concept` | tạo design brief (JSON) từ mô tả + screenshot |
| `/api/banner-generate` | gen MỘT ảnh cho một slot |
| `/api/banner-revise` | áp yêu cầu sửa vào brief |
| `/api/banner-localize` | dịch 4 chuỗi chữ in trên banner |
| `/api/mascot` | tìm mascot trong screenshot, hoặc tạo mới |
| `/api/keywords`, `/api/adcopy`, `/api/localize` | Ad Copy Studio |
| `/api/google-ads/*`, `/api/auth/google-ads/callback` | Launch Camp |

Mọi route đều gọi `requireSession()` ở dòng đầu. Ngoại lệ duy nhất là callback OAuth,
vì Google phải redirect vào được — nó nằm dưới `/api/auth/` nên được proxy bỏ qua.

## File quan trọng

- `app/page.tsx` — toàn bộ UI, một file lớn. Tên biến có tiền tố theo công cụ:
  `ab*` = AI Banner, `sd*` = Ad Copy Studio, `ads*` = Launch Camp, `yt*` = YouTube.
- `lib/adFormats.ts` — 3 tỉ lệ, 20 slot, 7 góc nhìn, `planGenSize()` tính size hợp lệ.
- `lib/abHistory.ts` — IndexedDB lưu lịch sử gen.
- `lib/googleAdsClient.ts` — gọi Google Ads API.
- `proxy.ts` — cổng đăng nhập (Next 16 đổi tên `middleware.ts` thành `proxy.ts`).

## Ràng buộc kích thước của model tạo ảnh

Model nhận WIDTHxHEIGHT tuỳ ý nhưng phải: mỗi cạnh chia hết 16, tỉ lệ trong khoảng
1:3–3:1, cạnh ≤3840px, tổng pixel từ 655.360 đến 8.294.400. `planGenSize()` lo việc này.

## Quy ước khi sửa code

- Đây là Next.js bản mới, API có thể khác bản cũ: đọc `node_modules/next/dist/docs/`
  trước khi viết code liên quan tới framework.
- Chạy `npx tsc --noEmit` và `npx next build` trước khi commit.
- Không hardcode khoá, không log khoá, không đưa khoá vào commit message hay PR.
