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
| `NEXTAUTH_SECRET` | ký phiên đăng nhập và link connector Claude; đổi = đăng xuất tất cả, mọi link connector cũ hết hiệu lực |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | đọc/ghi Google Sheets: user (`Users`), log đăng nhập (`LoginLog`), log sử dụng (`UsageLog`), đọc report Phân tích Camp |
| `SYSTEM_SHEET_ID` | (nên có) ID sheet hệ thống; bỏ trống thì dùng sheet của team gốc (`lib/sheetsLogger.ts`) |
| `NEXT_PUBLIC_BASE_URL` | URL gốc cho OAuth YouTube |
| `SENSORTOWER_API_KEY` | (tuỳ chọn) Competitor Ads |
| `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` / `KEYCLOAK_ISSUER` | (tuỳ chọn) SSO Keycloak; trang đăng nhập hiện chỉ dùng tài khoản trong sheet |
| `MKT_SYSTEM_URL` | (tuỳ chọn) thay mẫu link nút "Mở MKT System" (mặc định: trang Creative của `mktpro.aperogroup.ai` lọc theo tag, xem `lib/mktLink.ts`); được chứa `{tag}`, `{from}`, `{to}` |

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
| `/api/outro/app-info` | Outro Studio: tên app, icon, headline từ link store để tự tạo end card |
| `/api/outro/tutorial` | Outro Studio: GPT-4o-mini chấm từng khung (ảnh nhỏ) có phải đoạn hướng dẫn quay điện thoại không |
| `/api/outro/mkt/upload` | Outro Studio: ký các bước multipart (init/presign/complete/abort), thumbnail, tạo creative video trên MKT System |
| `/api/mcp/[key]` | Connector Claude (MCP, JSON-RPC qua HTTP, không giữ phiên): get_guide, app_info, check_ad_copy, mkt_status, mkt_next_gen, mkt_push_ad_templates, log_usage, log_feedback, get_lessons, banner_link. Khoá trong URL (`lib/mcpKey.ts`), proxy bỏ qua đăng nhập web; người bị tắt trong tab `Users` thì khoá ngừng chạy (`lib/userAccess.ts`) |
| `/api/mcp-key` | Link connector của người đang đăng nhập (hiện ở trang MKT System) |
| `/api/usage-log` | ghi 1 dòng log sử dụng vào tab `UsageLog` (email lấy từ phiên đăng nhập) |
| `/api/feedback` | ghi 1 lần người sửa / duyệt vào tab `Feedback` (vòng học) |
| `/api/lessons` | GET: tỉ lệ sửa theo version, lần sửa gần đây, bài học. POST (`manage_lessons`): `propose` (AI đề xuất bài học), `review` (áp dụng / sửa / bỏ) |
| `/api/account/password` | người đang đăng nhập tự đổi mật khẩu (kiểm tra mật khẩu hiện tại, tối đa 5 lần sai / 15 phút, ghi `LoginLog`) |

Mọi route đều gọi `requireSession()` ở dòng đầu. Ngoại lệ duy nhất là callback OAuth,
vì Google phải redirect vào được — nó nằm dưới `/api/auth/` nên được proxy bỏ qua.
Route tiêu tiền thật hoặc đọc doanh thu gọi `requireCapability(...)` thay cho `requireSession()`:
`/api/google-ads/*` (`launch_camp`), `/api/camp-sheets` (`camp_report`). Luật vai trò ở `lib/roles.ts`.

## Tài khoản, phiên đăng nhập, phân quyền

- Tab `Users` của sheet hệ thống: `Username | Password | Name | Active | Role`. Mật khẩu là mã băm scrypt
  (`scrypt$<salt>$<hash>`); ô chữ thường được tự thay bằng mã băm ở lần đăng nhập đúng kế tiếp (`lib/sheetsUsers.ts`).
- Phiên là JWT của NextAuth. Callback `jwt` (`lib/authOptions.ts`) đọc lại tab `Users` mỗi 4 phút
  (`lib/userAccess.ts`, cache 1 phút, nên thay đổi trong sheet tới mọi phiên trong vòng 5 phút): người bị tắt thì token mang cờ `revoked`, session không còn `user`, mọi API trả 401,
  `proxy.ts` chuyển về `/login`, trang tự đăng xuất. Role cũng được cập nhật theo cách này.
- Token giữ `pwStamp` (dấu vân tay ô mật khẩu lúc đăng nhập). Ô mật khẩu đổi (người dùng đổi trên web, admin đặt lại
  trong sheet) thì lần kiểm tra kế tiếp thu hồi phiên. Chỉ tin bản sheet đọc sau lúc đăng nhập (`readAt > signedInAt`),
  để cache cũ trên server khác không đăng xuất nhầm phiên vừa đăng nhập bằng mật khẩu mới.
- Phân loại dữ liệu, quy trình khi có người nghỉ, lịch sử siết quyền: `docs/du-lieu-va-bao-mat.md`.

## File quan trọng

- `app/page.tsx` — toàn bộ UI, một file lớn. Tên biến có tiền tố theo công cụ:
  `ab*` = AI Banner, `sd*` = Ad Copy Studio, `ads*` = Launch Camp, `yt*` = YouTube.
- `lib/abRender.ts` — vẽ logo, headline, CTA, badge Google Play lên ảnh nền AI Banner (canvas, chạy trong trình duyệt).
  Trang Banner + Ad Copy và bộ lệnh chat dùng chung file này.
- `chat/studio.mjs` — bộ lệnh để Claude Code gen banner, tạo ad template và đẩy lên MKT ngay trong chat, không mở web:
  bật server Next cục bộ, gọi đúng các route ở trên, vẽ chữ bằng `lib/abRender.ts` trong Chromium không giao diện.
  Quy trình cho Claude ở `.claude/skills/ads-chat/SKILL.md`. Khoá đọc từ biến môi trường của Environment Claude Code
  (`OPENAI_API_KEY`, `MKT_CONNECT_CODE`), không phải Vercel.
- `lib/adFormats.ts` — 3 tỉ lệ, 20 slot, 7 góc nhìn, `planGenSize()` tính size hợp lệ.
- `lib/abHistory.ts` — IndexedDB lưu lịch sử gen.
- `lib/googleAdsClient.ts` — gọi Google Ads API.
- `proxy.ts` — cổng đăng nhập (Next 16 đổi tên `middleware.ts` thành `proxy.ts`).
- `lib/roles.ts`, `lib/userAccess.ts`, `lib/sheetsUsers.ts`, `lib/authOptions.ts` — vai trò, tra tab `Users`, mật khẩu, phiên.
- `lib/learning.ts` (+ `lib/learningShared.ts`, `components/LessonsPage.tsx`) — vòng học: tab `Feedback`, `BaiHoc`,
  `lessonsBlock()` đưa bài học đã duyệt vào prompt (cache 5 phút; chat nhận qua biến `TEAM_LESSONS_JSON`), `qualityStats()`.

## Ràng buộc kích thước của model tạo ảnh

Model nhận WIDTHxHEIGHT tuỳ ý nhưng phải: mỗi cạnh chia hết 16, tỉ lệ trong khoảng
1:3–3:1, cạnh ≤3840px, tổng pixel từ 655.360 đến 8.294.400. `planGenSize()` lo việc này.

## Quy ước khi sửa code

- Đây là Next.js bản mới, API có thể khác bản cũ: đọc `node_modules/next/dist/docs/`
  trước khi viết code liên quan tới framework.
- Chạy `npx tsc --noEmit` và `npx next build` trước khi commit.
- Không hardcode khoá, không log khoá, không đưa khoá vào commit message hay PR.
