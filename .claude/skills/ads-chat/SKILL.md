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
@adbanner <link store> <thị trường…> auto [tối đa $X] [chất lượng] [góc: …]   ← chế độ auto (mục cuối)
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
   - Sửa chữ: sửa brief rồi `compose` lại (miễn phí, vài giây), và chạy
     `feedback --run <dir> --reason "<lời người dùng>"` để ghi lần sửa.
   - Sửa ảnh: `gen --slots <key> --revision "<yêu cầu>"` chỉ cho ảnh cần sửa (tốn tiền ảnh đó). Đưa **đúng lời
     người dùng** vào `--revision`: lệnh tự ghi lần sửa đó cho vòng học.
   - Muốn AI soi lỗi trước khi gửi người xem: `qa --run <dir> --set <MK>` (chữ đè mặt/tay/điện thoại, chữ bị cắt,
     hai nhân vật, tay dị dạng, chữ lạ trong tranh, sai ngôn ngữ; ~$0,003/ảnh).
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

**Vòng học:** mọi lần sửa (gen lại ảnh, localize lại có `--note`, lệnh `feedback`) và lần duyệt nháp lên đủ bộ được
ghi vào tab `Feedback`. Trên web, trang **🧠 Bài học** gom các lỗi lặp lại thành bài học; bài học được duyệt tự vào
prompt của web và của chat (server cục bộ lấy bài học qua connector lúc khởi động; bài học mới duyệt thì chạy `down`
rồi chạy lại lệnh để lấy).

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

## Chế độ auto

Chỉ dùng khi người dùng gõ chữ **auto** trong chính lệnh đó. Không tự suy ra từ câu khác, không tự bật cho lệnh sau.
Ở chế độ này AI tự kiểm tra ảnh thay cho bước người duyệt nháp, và tự đẩy lên MKT khi mọi cổng kiểm tra đều qua.

1. `doctor` như thường. Thiếu mã MKT, hết hạn, hoặc thiếu khoá OpenAI: dừng và nói rõ, không chạy auto.
2. `auto <link> --market <chính> [--to <khác,…>] [--prompt "<góc>"] [--quality …] [--max-usd <X>]`
   (mặc định chất lượng medium, trần $3). Không hỏi lại chi phí: lệnh tự dừng trước khi gen nếu chi phí xấu nhất
   (mọi ảnh gen lại 1 lần) vượt trần. Lệnh chạy: brief → 3 ảnh nháp → AI kiểm tra → AI tự gen lại ảnh trượt 1 lần
   → 17 ảnh còn lại → kiểm tra → tự sửa → localize → kiểm tra từng thị trường. 20 ảnh mất khoảng 10–15 phút.
3. Kết quả `ready: false`: **dừng ở đây, đây là ngoại lệ cần người.** Gửi ảnh xem trước nếu có (`sheet`), nói lý do
   (`stop`) và từng ảnh trượt kèm lỗi AI thấy, rồi hỏi người dùng muốn làm gì: sửa ảnh đó bằng `gen --revision`,
   bỏ qua lỗi, hay dừng. Từ đây làm như chế độ thường (có bước "ok").
4. Kết quả `ready: true`: gửi `previews` bằng SendUserFile để người dùng xem, **không hỏi ok**. Viết ad copy theo
   `guide` cho từng thị trường, `mkt check-copy` và tự sửa tới khi hết lỗi (tối đa 3 vòng; vẫn lỗi thì dừng và hỏi).
5. `mkt next-gen`, rồi `mkt push-templates` và `mkt push-creatives` cho từng thị trường, cùng một Gen.
6. Báo cáo: các bước trong `auto-report.json` (`steps`), số ảnh mỗi thị trường, AI đã tự sửa mấy ảnh, template tạo /
   cập nhật, tag, link `open`, chi phí ảnh `spentUsd` (ước tính). Nhắc: muốn sửa sau khi đã đẩy thì sửa rồi đẩy lại
   cùng Gen, template được cập nhật, không tạo trùng.

Lỗi AI bắt được tự ghi vào tab `Feedback` (loại "AI kiểm tra thấy lỗi") để vòng học gom thành bài học.

