# Changelog

Mỗi version ghi **mục tiêu**, **thời gian** và **thay đổi chính**. Version tăng theo mức độ thay đổi:

- **Số lớn** (v4 → v5): đổi cách làm việc của cả quy trình, thêm một công cụ mới, hoặc gộp công cụ.
- **Số nhỏ** (v5.1 → v5.2): sửa, cải tiến trong cùng quy trình.

Mỗi version có một git tag cùng tên (`v5.2`…). Muốn mở lại một version cũ, có 2 cách:

- **Xem code:** `git checkout v4.0`.
- **Chạy lại trên web:** vào Vercel → Deployments, chọn bản deploy của commit có tag đó, bấm **Promote to Production**.

Version đang chạy hiện ở cuối sidebar của web. Mỗi dòng trong log sử dụng (Google Sheet, tab `UsageLog`) cũng ghi version.

---

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
