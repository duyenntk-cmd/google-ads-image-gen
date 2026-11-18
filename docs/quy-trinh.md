# Quy trình: trước và sau khi có tool

Nghiệp vụ được phủ: **từ lúc một app cần creative mới cho Google App campaign, tới lúc creative chạy trên camp và
được đánh giá lại để làm vòng mới.**

Ký hiệu: 🤖 tool/AI tự làm · 👤 người làm hoặc duyệt · ✂️ bước đã bỏ hẳn.

> Cột "Khi làm tay" là bản nháp viết lại từ code và CHANGELOG. Chỗ nào khác với cách bạn từng làm thì sửa trực tiếp
> trong file này; đây là bản gốc để người khác đọc và dùng lại.

## 1. Banner + ad template (luồng chính)

Chạy trên web (trang Banner + Ad Copy) hoặc trong chat (`@adbanner`, `@adtemp`). Cùng code, cùng kết quả.

| # | Bước | Khi làm tay | Bây giờ | Ai |
|---|---|---|---|---|
| 1 | Đọc app | Mở store, đọc mô tả, chụp screenshot, tải icon | Đọc tên, nhà phát triển, mô tả, screenshot, icon từ link store (`/api/screenshots`); Play Store đổi HTML thì có đường đọc dự phòng | 🤖 |
| 2 | Xác nhận đúng app | Không có bước này | Nút **Kiểm tra** trên web, chat báo lại tên app trước khi tiêu tiền | 👤 checkpoint |
| 3 | Chọn thị trường, góc quảng cáo | Tự quyết | Người chọn thị trường (bắt buộc) và góc (tuỳ chọn); Auto Prompt viết creative direction cho đúng thị trường | 👤 + 🤖 |
| 4 | Viết brief cho designer | Viết tay, gửi designer, chờ | Brief dạng JSON (headline, phụ đề, CTA, màu, mood, nhân vật) tạo thẳng từ mô tả và screenshot | 🤖 |
| 5 | Vẽ banner | Designer vẽ từng size | Model vẽ phần tranh đúng từng tỉ lệ; canvas vẽ chữ, logo, badge nên chữ sắc nét và giống nhau ở mọi size | 🤖 |
| 6 | Duyệt bản nháp | Xem bản designer gửi | Gen 1 ảnh (web) hoặc 3 ảnh (chat) để duyệt trước, rồi mới gen cả bộ | 👤 checkpoint |
| 7 | Làm đủ bộ | Designer làm thêm size | Gen 20 ảnh cho 3 tỉ lệ 1.91:1, 1:1, 4:5, cùng một mascot | 🤖 |
| 8 | Sửa ảnh lỗi | Gửi lại designer | Người chỉ ảnh cần sửa và ghi yêu cầu; tool chỉ gen lại ảnh đó. Ảnh rớt do rate limit: tự chờ và gen lại phần thiếu | 👤 + 🤖 |
| 9 | Làm bản cho thị trường khác | Dịch chữ, designer làm lại cả bộ | Dịch 4 chuỗi chữ và vẽ lại lên ảnh cũ, không tốn tiền gen ảnh; dòng viết sai chữ (trộn tiếng Anh, sai bảng chữ) tự dịch lại | 🤖 |
| 10 | Viết ad copy | Viết tay 5 headline, 5 description mỗi khối, dịch từng thị trường | Claude viết và localize theo luật trong `get_guide` | 🤖 |
| 11 | Kiểm tra ad copy | Đếm ký tự bằng tay | `check_ad_copy`: giới hạn Google, trùng thị trường, câu kiểu CTA, chữ viết bản địa. Còn lỗi thì không cho đẩy | 🤖 chặn tự động |
| 12 | Đặt tên, đếm Gen | Đặt tên file, tag, tên template bằng tay, dễ trùng | Số Gen = Gen cao nhất trong ngày trên MKT + 1; tag `<ngày> Gen<n>` + mã thị trường; tên `Ad Template <ngày> Gen<n> <thị trường>` | 🤖 |
| 13 | Duyệt nháp cuối | Không có bước tổng hợp | Bảng ad copy kèm số ký tự, số ảnh, tag, tên template. Gõ **ok** mới đẩy | 👤 checkpoint |
| 14 | Upload creative lên MKT | Upload từng ảnh, gõ tag | Một lần đẩy cả bộ, kèm tag và thumbnail | 🤖 |
| 15 | Tạo ad template trên MKT | Nhập tay từng khối | Tạo theo tên chuẩn; đã có template cùng tên thì cập nhật, không tạo trùng (tránh lỗi "Ambiguous") | 🤖 |
| 16 | Ghép creative với template | Map tay trên MKT | **Bỏ hẳn** từ v5.2: tên và tag theo chuẩn Google++ nên MKT tự ghép | ✂️ |
| 17 | Tạo campaign | Tạo tay trên Google Ads | `Campaign Template <thị trường>` tạo tay một lần trên MKT. Launch Camp tạo App campaign ở trạng thái **PAUSED**, người tự bật | 👤 checkpoint |
| 18 | Theo dõi camp, chỉnh budget/tROAS | Đọc report, tự tính | Phân tích Camp ghép report Google Ads với est ROAS của system, gợi ý hành động theo luật (`lib/campDoctor.ts`). Người quyết và thao tác trên Google Ads | 🤖 gợi ý + 👤 quyết |
| 19 | Thay creative yếu | Tự phát hiện | Phân tích Camp báo asset bị policy hoặc yếu, nút **Tạo asset mới** mở Banner + Ad Copy để làm vòng mới | 🤖 + 👤 |

## 2. Video ads (Outro Studio)

| # | Bước | Khi làm tay | Bây giờ | Ai |
|---|---|---|---|---|
| 1 | Gom video | Tải về | Thả nhiều video vào một lần | 👤 |
| 2 | Tìm và cắt outro/end card cũ | Xem từng video, cắt trong phần mềm dựng | Tự tìm điểm cắt, cắt được cả đoạn có logo đối thủ | 🤖 |
| 3 | Cắt đoạn hướng dẫn quay điện thoại | Xem từng video | AI chấm từng khung. Đoạn ở cuối video: tự tick cắt. Đoạn ở giữa: hiện ra để người xem | 🤖 + 👤 khi không chắc |
| 4 | Resize 9:16, chèn logo, gắn outro mới | Làm từng video trong phần mềm dựng | Áp cùng thiết lập cho cả loạt, dựng trong trình duyệt | 🤖 |
| 5 | Xuất video | Xuất từng cái | Xuất hàng loạt, luôn đúng thời lượng | 🤖 |
| 6 | Đưa lên MKT | Upload từng video, nhập tên, tag, thumbnail, thời lượng | Một nút push cả loạt; người nhập tag và angle code | 🤖 + 👤 |
| 7 | Xem lại bộ đã đẩy | Tìm trên MKT | Lịch sử push theo ngày giờ, nút mở đúng bộ trên MKT | 🤖 |

## 3. Các bước đã bỏ khi tự động hoá

| Bước khi làm tay | Vì sao không cần nữa |
|---|---|
| Gửi brief cho designer rồi chờ | Brief đi thẳng vào bước gen ảnh |
| Designer làm lại từng kích thước | Mỗi tỉ lệ được gen riêng đúng kích thước thật |
| Designer làm lại cả bộ cho từng ngôn ngữ | Chữ do canvas vẽ, localize chỉ vẽ lại chữ |
| Đếm ký tự ad copy | Kiểm tra tự động, còn lỗi thì không cho đẩy |
| Đếm số Gen, đặt tên file, tag, template | Tính và đặt tên tự động theo chuẩn Google++ |
| Map creative với ad template trên MKT | MKT tự ghép theo tên và tag (v5.2) |
| Upload, gắn tag, tạo thumbnail từng file | Đẩy cả loạt bằng một lệnh |

## 4. Các điểm duyệt (checkpoint)

Nguyên tắc: người chỉ chặn ở chỗ **tốn tiền thật**, **ra ngoài thị trường** hoặc **AI không chắc**. Còn lại để máy
tự kiểm tra và tự chặn.

### Điểm người phải duyệt

| # | Ở đâu | Người làm gì | Vì sao phải có người | Chặn bằng gì |
|---|---|---|---|---|
| 1 | Trước khi gen | Xác nhận đúng app | Sai link là cả bộ sai và mất tiền gen | Nút Kiểm tra (web); skill `ads-chat` bước 1 báo tên app |
| 2 | Trước khi gen | Xem chi phí | Tiền thật | Giá hiện trên nút gen; skill `ads-chat` bước 4 báo chi phí và chờ đồng ý trước khi gen 20 ảnh |
| 3 | Sau bản nháp | Duyệt bố cục, nhân vật, chữ | Đây là chỗ AI hay sai nhất; nhìn vài giây là biết | Chế độ "1 ảnh duyệt trước" (web); `gen --slots core` + ảnh xem trước (chat) |
| 4 | Trước khi đẩy lên MKT | Duyệt ad copy, số ảnh, tag, tên template; gõ **ok** | Nội dung ra thẳng quảng cáo; thương hiệu và cam kết của app | Skill `ads-chat` bước 7–8, skill `adtemp` bước 3–5; mô tả tool `mkt_push_ad_templates` ghi "ONLY call this after the user has seen the draft and said ok" |
| 5 | Sau khi tạo campaign | Bật campaign | Bật là bắt đầu tiêu ngân sách | `app/api/google-ads/campaigns/route.ts` tạo campaign ở trạng thái `PAUSED` |
| 6 | Phân tích Camp | Quyết budget/tROAS và thao tác trên Google Ads | Cần ngữ cảnh ngoài số liệu (sự kiện, ngân sách tháng, ưu tiên app) | Tool chỉ gợi ý, không có quyền ghi vào Google Ads |
| 7 | Outro Studio | Xem các đoạn hướng dẫn nằm giữa video | AI không chắc đó có phải đoạn cần cắt | Đoạn ở cuối tự tick; đoạn ở giữa để trống chờ người tick |
| 8 | Outro Studio, khi push | Nhập tag, angle code | Thông tin nghiệp vụ, AI không biết | Ô nhập ngay trên nút push, giữ lại cho lần sau |

### Điểm máy tự chặn (không cần người)

| Điểm chặn | Ở đâu |
|---|---|
| Ad copy sai giới hạn Google hoặc khối không tạo được campaign: không gửi gì lên MKT | `validateAdContents` (`lib/mktClient.ts`), `check_ad_copy` |
| Template trùng tên theo cách so của Google++: cập nhật template cũ, không tạo thêm | `mkt_push_ad_templates`, trang Banner + Ad Copy |
| Chữ banner sai ngôn ngữ hoặc trộn tiếng Anh: dịch lại dòng đó | `lib/adCopyCheck.ts`, `/api/banner-localize` |
| Rate limit OpenAI: chờ đúng thời gian server báo rồi thử lại; chỉ gen lại ảnh lỗi | `/api/banner-generate`, nút "Gen lại N ảnh lỗi" |
| Push lại sau lỗi: không upload lại, không tạo trùng | Outro Studio, `idempotencyKey` của `/api/mkt/creatives` |
| Mã MKT hết hạn: dừng và báo lấy mã mới, không thử lại bằng mã cũ | `ConnectCodeExpiredError` |
| Tài khoản bị tắt hoặc không đủ quyền: chặn ở mọi API route | `requireSession`, `requireCapability` (`lib/apiAuth.ts`) |

## 5. Vòng học: tool tự tốt lên từ các lần người sửa

Mỗi điểm duyệt ở trên vừa chặn lỗi, vừa là dữ liệu để lần sau không mắc lại lỗi đó.

| Bước | Ai | Ở đâu |
|---|---|---|
| 1. Ghi lại mỗi lần người sửa (sửa 1 ảnh, sửa cả bộ, gen lại không lý do, localize lại) và mỗi lần duyệt nháp, kèm **lời người sửa** | 🤖 tự động, cả web lẫn chat | Tab `Feedback` của sheet hệ thống |
| 2. Đọc các lần sửa 60 ngày gần nhất, gom lỗi **lặp lại ít nhất 2 lần** thành bài học, mỗi bài học là một câu lệnh cho đúng bước (ảnh, brief, chữ localize, ad copy) | 🤖 AI, khi bấm **🤖 Tìm bài học mới** | Trang **🧠 Bài học**, tab `BaiHoc` (trạng thái *Chờ duyệt*) |
| 3. Đọc, sửa câu chữ nếu cần, **Áp dụng** hoặc **Bỏ** | 👤 checkpoint, chỉ role `ua` | Trang **🧠 Bài học** |
| 4. Bài học *Áp dụng* tự thêm vào prompt của bước tương ứng ở mọi lần chạy sau, trên web và trong chat | 🤖 | `lib/learning.ts` → các route `banner-generate`, `banner-concept`, `banner-localize`, `adcopy`, `get_guide` của connector |
| 5. Đo **số lần sửa trên 100 ảnh theo từng version**: bài học có làm giảm số lần sửa không; không giảm thì **Ngừng áp dụng** | 🤖 đo, 👤 quyết | Trang **🧠 Bài học**, bảng đầu trang |

AI không tự đổi prompt: mọi thay đổi đi qua bước 3. Lời yêu cầu sửa riêng của một lần (ô "Muốn sửa gì") vẫn được ưu
tiên hơn bài học chung. Các bài học viết tay từ trước nằm ở `skills/google-ads-studio/references/troubleshooting.md`.

## 6. Bước tiếp theo

- **Chạy theo mục tiêu:** một lệnh như `@adbanner <link> VN auto` tự đi hết các bước. Các điểm duyệt 1–4 thay bằng
  kiểm tra tự động (đúng app, chữ không đè nhân vật, đúng ngôn ngữ, ad copy qua kiểm tra), chỉ dừng hỏi người khi có
  ngoại lệ, như cách Outro Studio đang làm với đoạn hướng dẫn.
