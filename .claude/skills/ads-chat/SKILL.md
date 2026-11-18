---
name: ads-chat
description: Gen banner Google App campaign và tạo ad template ngay trong chat Claude Code của repo này, rồi đẩy lên MKT System bằng API (không mở trang web). Dùng khi người dùng gõ "@adbanner", "@adtemp", hoặc nhờ "gen banner/ảnh quảng cáo cho app", "tạo creative", "tạo ad template", "đẩy/push lên MKT" kèm link App Store / Google Play.
---

# Banner + Ad Template từ chat (chạy bằng `chat/studio.mjs`)

Mọi bước gọi đúng các API route của web, chạy trên server Next cục bộ (`localhost:3999`, lệnh tự bật),
và vẽ chữ lên ảnh bằng chính `lib/abRender.ts` của trang Banner + Ad Copy trong Chromium không giao diện.
Kết quả giống hệt làm trên web: cùng prompt, cùng bố cục, cùng tên file, tag và tên template trên MKT.

Lệnh: `node chat/studio.mjs <lệnh>` (chạy `help` để xem đủ tham số). Mỗi lượt có một thư mục
`chat/runs/<giờ>-<app>/`, dùng `--run` để trỏ vào. Thư mục này không commit.

## Cú pháp người dùng hay gõ

```
@adbanner <link store> <thị trường chính>[, thị trường khác…] [góc: …] [20 ảnh] [chất lượng cao]
@adtemp   <link store> <thị trường…> [góc: …]        ← chỉ ad template, không banner
```
Thị trường đầu tiên là thị trường chính (gen ảnh theo ngôn ngữ của nó); các thị trường sau dùng
cùng ảnh, chỉ dịch chữ. Thiếu thị trường thì hỏi.

## Quy trình

0. **`doctor`** trước tiên. Thiếu thứ gì thì dừng và nói rõ người dùng cần làm gì (mục "Thiết lập" bên dưới).
   **Không bao giờ xin dán khoá OpenAI hay mã MKT vào chat**: chúng là biến môi trường của Environment.
   Nếu người dùng tự dán mã `mktmcp_…` vào chat: ghi vào file trong scratchpad, dùng `--code-file <file>`,
   và nhắc họ lần sau đặt `MKT_CONNECT_CODE` trong Environment.
1. **`store <link> --market <chính>`**: in ra thư mục lượt chạy, tên app, nhà phát triển, mô tả.
   Báo lại tên app để người dùng chắc đúng app.
2. **`concept --run <dir> [--prompt "<góc>"]`** → `brief.<MK>.json` (headline ≤30, subheadline ≤45, CTA ≤12,
   tagline ≤32, màu, mood, nền sáng/tối, nhân vật và đạo cụ bằng tiếng Anh). Người dùng muốn đổi chữ:
   sửa thẳng file brief, giữ giới hạn ký tự.
3. **Nháp 3 ảnh:** `gen --run <dir> --slots core` (landscape-1, square-1, portrait-1; tự tìm hoặc gen mascot
   lần đầu), rồi `compose --run <dir> --set <MK>` và `sheet --run <dir> --set <MK>`.
   Gửi `preview-<MK>.png` bằng SendUserFile (display render) và hỏi: **ok** hay cần sửa gì.
   - Sửa chữ: sửa brief rồi `compose` lại (miễn phí, vài giây).
   - Sửa ảnh: `gen --slots <key> --prompt "<yêu cầu>"` chỉ cho ảnh cần sửa (tốn tiền ảnh đó).
4. **Bộ đầy đủ** (khi người dùng muốn 20 ảnh): báo chi phí trước, đợi đồng ý, rồi `gen --slots all`
   và `compose`. 20 ảnh mất khoảng 5–10 phút, vì chạy 2 ảnh cùng lúc.
5. **Thị trường khác:** `localize --run <dir> --to US,TH` → `brief.US.json`… rồi `compose --set US` và `sheet`
   cho từng thị trường. Gửi ảnh xem trước.
6. **Ad copy** (khi người dùng muốn ad template, hoặc lệnh @adtemp): đọc `guide` và tự viết theo đúng luật đó
   (bỏ phần "Banner" trong guide: ở đây banner gen ngay trong chat). Lưu `templates.json`
   dạng `{ "templates": [ { "market": "VN", "blocks": [ { "headlines": [...], "descriptions": [...] } ] } ] }`,
   chạy `mkt check-copy --file … --app "<tên app>"` tới khi hết lỗi.
7. **`mkt next-gen --markets VN,US`** → số Gen hôm nay. **Hiện nháp cuối**, gồm:
   - bảng ad copy từng thị trường kèm số ký tự;
   - số ảnh từng thị trường;
   - tag creative `<ngày> Gen<n>` + mã thị trường;
   - tên template `Ad Template <ngày> Gen<n> <MK>`.

   Hỏi "gõ ok để đẩy".
8. **Chỉ khi người dùng đồng ý** (ok / đẩy / được): `mkt push-templates --file … --gen <n> --app "<tên>"`
   (nếu có ad copy), rồi `mkt push-creatives --run <dir> --set <MK> --gen <n>` cho từng thị trường.
   Cùng Gen cho cả template lẫn creative thì Google++ mới ghép được. Đẩy lại cùng Gen: template được
   cập nhật, không tạo trùng.
9. Báo kết quả: số creative mỗi thị trường, template tạo/cập nhật, link `open` để mở đúng bộ trên MKT.

**Log sử dụng:** `gen`, `localize`, `mkt push-templates` và `mkt push-creatives` tự ghi một dòng vào tab `UsageLog`
(công cụ "Chat Claude Code", đúng tên người dùng) qua link connector `GAIC_CONNECTOR_URL`. Chưa có biến này hoặc web
không vào được thì dòng log nằm tạm ở `chat/runs/usage-pending.jsonl` và được gửi kèm lần ghi thành công sau.
Lệnh in "! chưa ghi được log sử dụng" thì nhắc người dùng một câu ở cuối, không dừng việc.

## Chi phí ảnh (giá OpenAI, mỗi ảnh)

| Chất lượng | Mỗi ảnh |
|---|---|
| low | ~$0.006 |
| medium (mặc định) | ~$0.053 |
| high | ~$0.211 |

Mascot gen mới tính thêm 1 ảnh. Brief, dịch và tìm mascot dùng gpt-4o-mini, chi phí không đáng kể.

## Thiết lập (người dùng làm một lần, trong cài đặt Environment của Claude Code, rồi mở phiên mới)

- **Khoá OpenAI**: nên đặt ở **Network secrets** (Allowed websites `api.openai.com`, Header `Authorization`,
  Prefix `Bearer`): phiên không bao giờ thấy khoá, proxy tự gắn. Không có mục đó thì đặt biến `OPENAI_API_KEY`.
- **Biến môi trường `GAIC_CONNECTOR_URL`**: link connector của chính người dùng (web → trang **MKT System** →
  "Lấy link connector của tôi"). Dùng để ghi log sử dụng đúng tên người làm; thiếu thì việc làm trong chat không được tính.
  Link này là khoá cá nhân: không dán vào chat, không chia sẻ.
- **Biến môi trường `MKT_CONNECT_CODE`**: mã `mktmcp_…` lấy ở MKT System > Profile > Kết nối Claude.
  Mã hết hạn sau khoảng 24 giờ: mỗi ngày làm việc phải thay mã mới và mở phiên mới.
- **Network access**: chọn Full, hoặc Limited và thêm vào Allowed domains:
  `api.openai.com`, `play.google.com`, `play-lh.googleusercontent.com`, `apps.apple.com`, `itunes.apple.com`,
  `*.mzstatic.com`, `*.aperogroup.ai`, `*.amazonaws.com`, `google-ads-image-gen.vercel.app` (log sử dụng).
  `doctor` in ra máy chủ backend MKT thật lấy từ mã; nếu máy chủ đó báo bị chặn thì thêm nó vào.
  Đổi Network access có hiệu lực với cả phiên đang chạy sau khoảng 1 phút; đổi biến môi trường thì cần phiên mới.

## Lỗi hay gặp

- `/api/screenshots: Google Play chặn request (403)`: thường là mạng của Environment chặn chứ không phải Google.
  Chạy `doctor` để xem.
- `Chưa có mã kết nối MKT` hoặc `Mã kết nối đã hết hạn`: thiếu `MKT_CONNECT_CODE` hoặc mã đã quá 24 giờ.
  Người dùng cần đặt mã mới trong Environment rồi mở phiên mới.
- Server cục bộ không lên: xem `chat/.state/server.log`; `down` rồi chạy lại lệnh.
  Code của repo đổi thì lệnh tự build lại (1–2 phút).
