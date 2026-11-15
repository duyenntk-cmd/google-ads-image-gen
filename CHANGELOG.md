# Changelog

Mỗi version ghi **mục tiêu**, **thời gian** và **thay đổi chính**. Version tăng theo mức độ thay đổi:

- **Số lớn** (v4 → v5): đổi cách làm việc của cả quy trình, thêm một công cụ mới, hoặc gộp công cụ.
- **Số nhỏ** (v5.1 → v5.2): sửa, cải tiến trong cùng quy trình.

Mỗi version có một git tag cùng tên (`v5.2`…). Muốn mở lại một version cũ, có 2 cách:

- **Xem code:** `git checkout v4.0`.
- **Chạy lại trên web:** vào Vercel → Deployments, chọn bản deploy của commit có tag đó, bấm **Promote to Production**.

Version đang chạy hiện ở cuối sidebar của web. Mỗi dòng trong log sử dụng (Google Sheet, tab `UsageLog`) cũng ghi version.

---

## v6.5 — 2026-11-13 · Outro Studio: quét và push nhanh hơn

**Mục tiêu:** rút ngắn thời gian từ lúc thả video vào tới lúc creative nằm trên MKT.

- Quét: ảnh gửi AI tìm đoạn hướng dẫn lấy từ keyframe (giải mã ~30 khung thay vì cả video), và gửi AI ngay từ đầu,
  chạy song song với bước tìm end card. Quét 2 video cùng lúc (máy yếu vẫn quét lần lượt).
  Đo thử 3 video 30 giây: 55 giây → 25 giây.
- Push: server giữ lại mã truy cập MKT giữa các lần gọi (trước đây lần gọi nào cũng xin lại), bước khởi tạo trả luôn
  link upload, thumbnail tải song song với video, đẩy 3 video cùng lúc. Trang Banner + Ad Copy cũng nhanh hơn nhờ
  phần giữ mã truy cập. Đo thử 5 video 27MB (mỗi lần gọi MKT trễ 0,3 giây): 27,5 giây → 7,7 giây, lần gọi MKT 53 → 33.
- Báo thời gian của lần push vừa rồi.

## v6.4 — 2026-11-13 · Outro Studio: tự cắt đoạn hướng dẫn quay điện thoại

**Mục tiêu:** bỏ đoạn cuối "hướng dẫn cách làm video/ảnh AI" (quay chiếc điện thoại mở TikTok/CapCut, tay hoặc bút bấm
vào màn hình) vì khác giao diện app mình.

- Mỗi video được lấy mẫu khoảng mỗi giây một khung, GPT-4o-mini (`/api/outro/tutorial`, khoá `OPENAI_API_KEY`) chấm từng
  khung có phải đoạn hướng dẫn không. Các khung liền nhau gộp thành đoạn, điểm cắt dò chính xác ở 30 khung/giây.
- Đoạn chạm tới cuối video (hoặc tới chỗ cắt outro) được tick cắt sẵn; đoạn nằm giữa video thì hiện để tự xem và tick.
  Gần như cả video giống màn hình điện thoại thì không tự cắt.
- Bật/tắt ở "Đoạn cắt trong video" (mặc định bật). Lỗi AI thì báo lỗi, có nút Thử lại, video xử lý như trước.
- Khi đoạn hướng dẫn đã cắt tới hết video, phần tìm end card không còn bắt chọn điểm cắt nằm trong đoạn đó.

## v6.3 — 2026-11-13 · Outro Studio: hết giật và kéo dài khi dựng realtime

**Mục tiêu:** video xuất ra (và đẩy lên MKT) luôn đúng thời lượng, không giật.

- Nguyên nhân: video nào không dựng nhanh được (file không phải MP4 như WebM, codec lạ, máy quá tải khi xuất
  song song) thì chuyển sang dựng realtime bằng MediaRecorder. Cách này gắn thời gian khung theo đồng hồ thật,
  nên máy chậm là mất khung (giật), còn chuyển tab thì trình duyệt ngừng vẽ nhưng vẫn ghi: video đứng hình suốt
  lúc tab ẩn và dài gấp nhiều lần. Thử lại: nguồn 8 giây + outro 3 giây, ẩn tab 20 giây, ra 25,4 giây, 164 khung.
- Sửa: dựng realtime giờ nén mỗi 1/30 giây của dòng thời gian video đúng 1 khung (máy chậm thì lặp khung, không
  kéo dài), tiếng trộn offline như dựng nhanh, ra MP4 chuẩn 30 fps. Chuyển tab thì tạm dừng, quay lại chạy tiếp.
  Cùng bài thử ra 11,02 giây, 330 khung, không đứng hình.
- Video phải dựng realtime chờ các video dựng nhanh xong rồi dựng lần lượt từng cái, để máy không bận việc khác.
- Trình duyệt không có WebCodecs vẫn ghi bằng MediaRecorder như cũ, nhưng tạm dừng khi tab bị ẩn.

## v6.2 — 2026-11-12 · Lịch sử push lên MKT

**Mục tiêu:** xem lại các bộ video đã đẩy lên MKT System theo ngày giờ.

- Outro Studio: khung "Lịch sử push lên MKT" lưu mỗi lần push thành công (ngày giờ, số video, tên video, tag, angle code,
  tài khoản MKT), nhóm theo ngày. Mỗi dòng có nút mở đúng bộ đó trên MKT (lọc theo tag và ngày push).
  Lưu trong trình duyệt (IndexedDB), giữ 300 lần push gần nhất.

## v6.1 — 2026-11-12 · Link thẳng tới bộ creative vừa đẩy

**Mục tiêu:** đẩy xong bấm một nút là thấy đúng bộ creative vừa tạo trên MKT System.

- Nút "Mở MKT System" (Banner + Ad Copy và Outro Studio) mở thẳng trang Creative của MKT System,
  lọc sẵn theo tag vừa đẩy, khoảng ngày 30 ngày gần nhất như mặc định của trang đó.
- Outro Studio: lỗi push ghi rõ bước hỏng (khởi tạo, gửi S3, hoàn tất, tạo creative); tên file trên S3
  rút gọn, không dấu; thời lượng video gửi số giây nguyên.

## v6.0 — 2026-11-12 · Outro Studio

**Mục tiêu:** làm lại outro cho video ads hàng loạt và đưa thẳng video thành phẩm vào thư viện creative MKT System.

- Thêm công cụ Outro Studio (`/outro-studio`): cắt outro/end card cũ, resize 9:16, logo bay, gắn outro mới, xuất MP4 hàng loạt.
- Push video lên MKT System: dùng chung mã kết nối với Banner + Ad Copy, nhập tag và angle code, một nút push tất cả,
  xong thì mở MKT System ở tab mới. Video lên S3 thẳng từ trình duyệt; bấm lại sau lỗi không upload lại, không tạo trùng.
- Log sử dụng ghi thêm việc "Push video lên MKT" của Outro Studio.

## v5.3 — 2026-11-12 · Đo được việc dùng thật

**Mục tiêu:** có bằng chứng sử dụng thật (tần suất, khối lượng, thời gian), và quản lý version.

- Log sử dụng: mỗi lần chạy xong một việc thì ghi 1 dòng vào tab `UsageLog` của Google Sheet hệ thống.
  Các việc được ghi: gen ảnh duyệt, gen bộ ảnh, gen lại ảnh, localize, gen ad copy, tạo ad template, upload creative,
  đẩy lên MKT, phân tích camp. Mỗi dòng gồm: thời gian, người, công cụ, app, thị trường, số ảnh, số template,
  thời gian chạy, kết quả, version.
- Thêm CHANGELOG, git tag cho từng version, và hiện số version trên web.

## v5.2 — 2026-11-03 · Đặt tên theo Google++

**Mục tiêu:** MKT System (Google++) tự ghép đúng creative với ad template, không cần map tay.

- Tag creative: một tag main `<ngày> Gen<n>` và một tag thị trường.
- Tên template: `Ad Template <ngày> Gen<n> <thị trường>`.
- Chặn tạo template trùng tên (lỗi "Ambiguous"); nếu đã có template cùng tên thì cập nhật template đó.
- Có nút mở MKT System và nút chép tag của bộ gen sau khi upload.

## v5.1 — 2026-10-23 · Localize theo thị trường

**Mục tiêu:** localize đủ các thị trường đang chạy, mỗi thị trường dùng đúng ngôn ngữ bản địa.

- Chọn thị trường thay vì chọn ngôn ngữ.
- Thêm nhiều thị trường và ngôn ngữ.

## v5.0 — 2026-10-16 → 10-18 · Phân tích Camp

**Mục tiêu:** từ report hằng ngày, tự gợi ý hành động cho từng camp tROAS.

- Ghép report Google Ads với est ROAS của data system.
- Khung quyết định budget/tROAS với target ROAS D0 = 100%.
- Lưu lịch sử 14 ngày để biết camp đã ổn định chưa.
- Không gợi ý tăng budget khi camp chưa tiêu hết budget.

## v4.1 — 2026-10-14 → 10-15 · Chất lượng localize

**Mục tiêu:** bản localize đủ ảnh và đúng ngôn ngữ.

- Vẽ lại các bộ ảnh đã localize khi artwork thay đổi.
- Không trộn ngôn ngữ (Taglish, Hinglish). Viết bằng chữ bản địa; dòng nào viết sai chữ thì tự dịch lại.
- Nút "Localize lại" kèm ghi chú.

## v4.0 — 2026-09-30 → 10-08 · Kết nối MKT System, một trang ba bước

**Mục tiêu:** từ link store đến creative và ad template trên MKT trong một luồng.

- Kết nối MKT System bằng connect code, upload creative, tạo ad template.
- Ad Copy Studio: gom khối nội dung qua nhiều keyword, localize theo khối, mỗi thị trường một template.
- Gộp AI Banner và Ad Copy Studio thành trang "Banner + Ad Copy": bước 1 nhập link, bước 2 gen ảnh duyệt cùng ad copy,
  bước 3 gen đủ bộ, localize, đẩy hết lên MKT một lần.

## v3.0 — 2026-09-16 → 09-29 · AI Banner cho App campaign

**Mục tiêu:** gen đủ bộ creative cho App campaign từ link store, không cần designer.

- AI Banner: gen 20 asset đúng tỉ lệ App campaign, có ảnh duyệt trước, sửa từng ảnh, localize, lưu các lần chạy.
- Gộp Keywords, Ad Copy và Localize thành Ad Copy Studio.
- Thêm Launch Campaign và skill mô tả bộ công cụ.

## v2.1 — 2026-08-11 → 09-16 · Đăng nhập và bảo mật

**Mục tiêu:** chỉ người trong team dùng được, và biết ai đăng nhập.

- Đăng nhập bằng user/mật khẩu quản lý trên Google Sheets, ghi log đăng nhập.
- Thêm kiểm tra phiên đăng nhập cho từng API route.
- Thêm Ad Copy Localizer nhiều thị trường.

## v2.0 — 2026-07-13 → 07-18 · Bộ công cụ nhiều tool

**Mục tiêu:** gom các việc lặp lại của UA vào một web.

- Ad Copy Generator, Keyword Research, YouTube bulk upload (unlisted).
- Thiết kế lại giao diện: sidebar cố định, trang chủ dashboard.

## v1.1 — 2026-06-30

- Mở rộng lên 32 ngôn ngữ, thêm slide giới thiệu.

## v1.0 — 2026-06-21 · Gen Banner

**Mục tiêu:** cắt và xoá chữ trên ảnh lấy từ video ads, để làm banner Google Ads.

- Gen Banner từ video, inpaint xoá chữ, tự lấy tên và icon app, xem trước trên khung thiết bị, lưu lịch sử.
