# Google Ads Studio

Bộ công cụ cho team UA app mobile. Từ một link App Store / Google Play, tool làm ra banner cho App campaign, ad copy
đã localize, ad template đặt tên đúng chuẩn Google++, video ads đã thay outro, rồi đẩy hết lên MKT System. Ngoài ra
có Launch Camp (tạo campaign Google Ads), Phân tích Camp (gợi ý budget/tROAS từ report) và YouTube Upload.

Version hiện tại nằm trong `package.json` và ở cuối sidebar của web. Lịch sử từng version: [CHANGELOG.md](CHANGELOG.md).

## Dùng ở đâu

| Cách dùng | Dành cho | Bắt đầu |
|---|---|---|
| Web | Mọi người trong team | https://google-ads-image-gen.vercel.app, tài khoản do admin cấp |
| Connector trong Claude (`@adtemp`) | Tạo ad template bằng chat trên claude.ai | Web → **MKT System** → "Lấy link connector của tôi" → Claude → Settings → Connectors |
| Claude Code (`@adbanner`) | Gen banner và đẩy MKT ngay trong chat, không mở web | `node chat/studio.mjs doctor`, xem [.claude/skills/ads-chat/SKILL.md](.claude/skills/ads-chat/SKILL.md) |

## Tài liệu

| File | Nội dung |
|---|---|
| [docs/quy-trinh.md](docs/quy-trinh.md) | Quy trình làm tay và quy trình hiện tại: bước nào AI làm, bước nào người làm, bước nào đã bỏ; các điểm duyệt |
| [docs/danh-muc-dau-viec.md](docs/danh-muc-dau-viec.md) | Danh mục đầu việc lặp lại, mức tự động hoá, cách đo thời gian tiết kiệm từ log |
| [docs/du-lieu-va-bao-mat.md](docs/du-lieu-va-bao-mat.md) | Dữ liệu nào đi đâu, ai đọc được gì, phân quyền, quy trình khi có người nghỉ, lịch sử siết quyền |
| [skills/google-ads-studio/](skills/google-ads-studio/SKILL.md) | Cách dùng từng công cụ, kiến trúc, API route, lỗi thường gặp |
| [CHANGELOG.md](CHANGELOG.md) | Mục tiêu và thay đổi của từng version, cách mở lại version cũ |

## Dựng lại từ đầu

Làm đúng thứ tự dưới đây là có một bản chạy được, không cần hỏi ai. Mất khoảng 30–45 phút.

**Cần có:** Node.js 20 trở lên, tài khoản GitHub và Vercel, một Google Cloud project, khoá OpenAI và khoá Anthropic.

### 1. Lấy code

```bash
git clone https://github.com/duyenntk-cmd/google-ads-image-gen.git
```

```bash
cd google-ads-image-gen && npm ci
```

### 2. Tạo Google Sheet hệ thống

1. Tạo một Google Sheet mới. Lấy ID trong link (đoạn giữa `/d/` và `/edit`), dùng cho biến `SYSTEM_SHEET_ID`.
2. Tạo tab tên **`Users`**. Để trống cũng được, app tự ghi hàng tiêu đề `Username | Password | Name | Active | Role`.
3. Thêm một dòng cho chính bạn: Username, mật khẩu gõ chữ thường, tên hiển thị, Active để trống (hoặc `yes`), Role để trống.
   Lần đăng nhập đầu, app tự thay mật khẩu trong sheet bằng bản đã mã hoá (`scrypt$…`).
4. Hai tab `LoginLog` (lịch sử đăng nhập) và `UsageLog` (log sử dụng) app tự tạo khi cần.

### 3. Tạo service account để app đọc/ghi sheet

1. Google Cloud Console → **APIs & Services** → bật **Google Sheets API**.
2. **IAM & Admin → Service Accounts** → tạo service account → tab **Keys** → **Add key → JSON**, tải file về.
3. Mở Google Sheet ở bước 2 → **Share** → dán email của service account (`…@….iam.gserviceaccount.com`), quyền **Editor**.
4. Nội dung file JSON (cả file, một dòng) là giá trị của `GOOGLE_SERVICE_ACCOUNT_JSON`.

### 4. Điền biến môi trường

Chép [`.env.example`](.env.example) thành `.env.local` và điền. Năm biến bắt buộc: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
`GOOGLE_SERVICE_ACCOUNT_JSON`, `SYSTEM_SHEET_ID`, `OPENAI_API_KEY`. Thêm `ANTHROPIC_API_KEY` nếu dùng Ad Copy Studio.
Tạo `NEXTAUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 5. Chạy thử trên máy

```bash
npm run dev
```

Mở http://localhost:3000/login, đăng nhập bằng tài khoản ở bước 2. Kiểm tra:

- [ ] Đăng nhập được, tab `LoginLog` có thêm một dòng.
- [ ] Ô Password của bạn trong tab `Users` đã thành `scrypt$…`.
- [ ] Banner + Ad Copy: dán một link Google Play, gen ảnh duyệt (1 ảnh vuông), tab `UsageLog` có thêm một dòng.

### 6. Deploy lên Vercel

1. Vercel → **Add New Project** → import repo.
2. **Settings → Environment Variables**: điền như `.env.local`, riêng `NEXTAUTH_URL` là domain Vercel của bạn.
3. **Deploy**. Nếu nhánh production không phải nhánh bạn đang làm, mỗi bản deploy phải bấm **Promote to Production**
   mới lên domain chính.

### 7. Phần tuỳ chọn

| Phần | Cần làm thêm |
|---|---|
| Launch Camp | OAuth client trong Google Cloud, redirect URI `<NEXTAUTH_URL>/api/auth/google-ads/callback`; developer token Google Ads mức Basic Access; điền `GOOGLE_ADS_*` |
| YouTube Upload | Bật YouTube Data API, OAuth client với redirect URI `<NEXT_PUBLIC_BASE_URL>/api/auth/callback`; điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_BASE_URL` |
| MKT System | Không cần biến môi trường: mỗi người dán mã kết nối của mình (MKT System → Profile → Kết nối Claude). Tạo tay một lần `Campaign Template <THỊ TRƯỜNG>` trên MKT cho mỗi thị trường |
| Competitor Ads | `SENSORTOWER_API_KEY` |
| Connector Claude | Không cần thêm gì: link lấy ở trang MKT System, ký bằng `NEXTAUTH_SECRET` |

## Biến môi trường

| Biến | Bắt buộc | Dùng cho |
|---|---|---|
| `NEXTAUTH_URL` | có | URL gốc của web; dựng redirect URI và link connector |
| `NEXTAUTH_SECRET` | có | Ký phiên đăng nhập và link connector. Đổi giá trị = đăng xuất tất cả, mọi link connector cũ hết hiệu lực |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | có | Đọc/ghi sheet hệ thống (Users, LoginLog, UsageLog), đọc report Phân tích Camp |
| `SYSTEM_SHEET_ID` | nên có | ID sheet hệ thống. Bỏ trống thì dùng sheet của team gốc |
| `OPENAI_API_KEY` | có | Gen ảnh, brief, mascot, localize banner, Outro Studio |
| `ANTHROPIC_API_KEY` | khi dùng Ad Copy Studio | Keyword, ad copy, localize ad copy |
| `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_MCC_CUSTOMER_ID` | khi dùng Launch Camp | Google Ads API |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_BASE_URL` | khi dùng YouTube Upload | OAuth YouTube |
| `MKT_SYSTEM_URL` | không | Mẫu link nút "Mở MKT System", được chứa `{tag}`, `{from}`, `{to}` |
| `SENSORTOWER_API_KEY` | không | Competitor Ads |
| `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_ISSUER` | không | SSO Keycloak (trang đăng nhập hiện chỉ dùng tài khoản trong sheet) |

Bộ lệnh chat (`chat/studio.mjs`) đọc thêm `MKT_CONNECT_CODE` và `GAIC_CONNECTOR_URL` từ Environment của Claude Code,
không đặt trên Vercel. Chi tiết ở [.claude/skills/ads-chat/SKILL.md](.claude/skills/ads-chat/SKILL.md).

Mọi khoá chỉ nằm trong biến môi trường. Không viết khoá vào code, không log khoá, không dán khoá vào chat.

## Quản lý tài khoản

Tất cả làm trong tab `Users` của sheet hệ thống, có hiệu lực trong vòng 5 phút, không cần deploy:

| Việc | Cách làm |
|---|---|
| Thêm người | Thêm dòng: Username, mật khẩu chữ thường (tự mã hoá ở lần đăng nhập đầu), Name, Role |
| Tắt người (nghỉ việc, chuyển bộ phận) | Ghi `no` vào cột Active. Phiên đang mở và link connector của người đó ngừng chạy |
| Tự đổi mật khẩu | Mỗi người tự đổi trên web: nút **Đổi mật khẩu** dưới tên ở cuối sidebar. Đổi xong thì bị đăng xuất ở mọi nơi |
| Quên mật khẩu | Admin gõ đè mật khẩu mới (chữ thường) vào ô Password, báo cho người đó. Mọi phiên đang mở của người đó bị đăng xuất trong vòng 5 phút |
| Đổi quyền | Cột Role: để trống hoặc `ua` = mọi công cụ; `creative` = không có Launch Camp và Phân tích Camp |

Quy trình đầy đủ khi có người nghỉ: [docs/du-lieu-va-bao-mat.md](docs/du-lieu-va-bao-mat.md).

## Phát triển

- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4. API của Next 16 khác bản cũ: đọc `node_modules/next/dist/docs/`
  trước khi sửa phần liên quan tới framework (ví dụ `middleware.ts` đã đổi tên thành `proxy.ts`).
- Trước khi commit:

  ```bash
  npx tsc --noEmit && npx next build
  ```

- Đổi version: tăng `version` trong `package.json`, viết mục mới trong `CHANGELOG.md`; sau khi merge vào `main`,
  thêm dòng version vào `scripts/tag-versions.sh` và chạy script để gắn tag (cách làm ở đầu CHANGELOG).

## Đã có ai dựng lại chưa

Mỗi lần có người dựng lại tool từ hướng dẫn này, ghi một dòng. Phải hỏi ở bước nào thì sửa hướng dẫn ở bước đó.

| Ngày | Người dựng | Dựng ở đâu | Có phải hỏi không, hỏi gì | Đã sửa hướng dẫn |
|---|---|---|---|---|
| | | | | |
