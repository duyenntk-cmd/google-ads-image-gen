# Danh mục đầu việc vận hành lặp lại

Mục đích: liệt kê đủ các việc lặp lại của UA creative, mỗi việc tự động được bao nhiêu, và chứng minh bằng log chứ
không bằng lời. Mọi con số "đã dùng" lấy từ tab `UsageLog` của sheet hệ thống.

## Cách đọc bảng

- **Phút làm tay:** thời gian một lần làm việc đó khi chưa có tool. **Ô `⟨điền⟩` là số bạn cần tự đo một lần**
  (bấm giờ một lần làm tay, hoặc lấy số designer/UA hay báo). Không có số này thì không tính được thời gian tiết kiệm.
- **Phút còn lại:** thời gian người vẫn phải bỏ ra khi dùng tool (dán link, duyệt, nhập tag), không tính lúc máy chạy.
- **% tự động** = 1 − phút còn lại ÷ phút làm tay.
- **Log:** cột `Công cụ` / `Hành động` trong `UsageLog` để đếm số lần làm.

## Danh mục

| # | Đầu việc | Tần suất | Phút làm tay / lần | Phút còn lại / lần | % tự động | Công cụ | Log (`Công cụ` / `Hành động`) |
|---|---|---|---|---|---|---|---|
| 1 | Làm lại outro cho 1 loạt video ads (cắt outro, cắt đoạn hướng dẫn, 9:16, logo, end card mới) | Hằng ngày | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Outro Studio | `Outro Studio` / `Push video lên MKT` (cột Số ảnh = số video) |
| 2 | Đưa loạt video lên MKT kèm tag, angle, thumbnail, thời lượng | Hằng ngày | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Outro Studio | như trên |
| 3 | Làm bộ banner App campaign 20 ảnh, 3 tỉ lệ, cho 1 app / 1 thị trường | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Banner + Ad Copy, `@adbanner` | `Banner + Ad Copy` hoặc `Chat Claude Code` / `Gen ảnh duyệt`, `Gen bộ ảnh`, `Gen lại ảnh` |
| 4 | Làm bản banner cho thị trường khác | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Banner + Ad Copy, `@adbanner` | `… / Localize`, `Localize lại` |
| 5 | Viết ad copy và localize | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Ad Copy Studio, `@adtemp` | `Ad Copy Studio` / `Gen ad copy` |
| 6 | Tạo ad template trên MKT đúng tên Google++ | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Banner + Ad Copy, `@adtemp`, `@adbanner` | `… / Tạo ad template`, `Tạo ad template theo thị trường`; `Claude connector` |
| 7 | Upload bộ banner lên MKT kèm tag | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Banner + Ad Copy, `@adbanner` | `… / Đẩy lên MKT`, `MKT System / Upload creative` |
| 8 | Ghép creative với ad template trên MKT | Mỗi đợt | ⟨điền⟩ | 0 | **100% (đã bỏ hẳn, v5.2)** | Đặt tên chuẩn Google++ | Không cần log: bước không còn tồn tại |
| 9 | Đọc report, quyết budget/tROAS cho từng camp | Hằng ngày | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Phân tích Camp | `Phân tích Camp` / `Phân tích camp` |
| 10 | Tạo App campaign mới | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Launch Camp | `Launch Camp` / `Tạo campaign` (có log từ v7.2) |
| 11 | Up video YouTube unlisted lấy link chạy ads | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | YouTube Upload | `YouTube Upload` / `Up video unlisted` (có log từ v7.2) |
| 12 | Ra ảnh tĩnh nhiều kích thước từ video ads | ⟨điền⟩ | ⟨điền⟩ | ⟨điền⟩ | ⟨tính⟩ | Gen Banner | `Gen Banner` / `Gen ảnh từ video` (có log từ v7.2) |
| 13 | ⟨đầu việc lặp lại khác chưa có tool⟩ | | | | 0% | chưa có | |

Dòng 13 trở đi: ghi cả những việc lặp lại **chưa** tự động. Tỉ lệ chung chỉ đúng khi danh mục đủ, kể cả việc chưa làm được.

## Tỉ lệ chung

```
% tự động chung = Σ (số lần trong tuần × (phút làm tay − phút còn lại)) ÷ Σ (số lần trong tuần × phút làm tay)
```

Tính theo tuần, số lần lấy từ `UsageLog`. Mốc của thang đánh giá: 60–70% là mức 3, 70–80% và không gãy khi dữ liệu
bất thường là mức 4, trên 80% và đã bỏ hẳn một số đầu việc là mức 5.

## Số liệu đã có (UsageLog, 12–18/11/2026)

Log bắt đầu ghi từ v5.3 (12/11/2026). Đọc ngày 18/11/2026:

| Chỉ số | Giá trị |
|---|---|
| Số lượt ghi log | 53, có mặt đủ 5 ngày làm việc (12, 13, 16, 17, 18/11) |
| Công cụ có log | Chỉ Outro Studio (`Push video lên MKT`) |
| Video đẩy lên MKT | 445 (khoảng 89 video mỗi ngày làm việc) |
| Thành công / lỗi | 49 / 4 (3 lỗi "Internal server error" ngày 12/11 lúc mới ra v6.0, v6.1 sửa cách báo lỗi; 1 lỗi HTTP 503 của MKT ngày 16/11, push lại thành công ngay sau đó) |
| Thời gian push trung bình | khoảng 38 giây mỗi lượt (chỉ tính bước push, chưa tính dựng video) |
| Số người | 1 |

Chưa có dòng nào cho Banner + Ad Copy, Ad Copy Studio, Phân tích Camp, connector Claude và chat. Ba việc cần làm để
danh mục này chứng minh được mức tự động:

1. Điền cột "Phút làm tay" và "Phút còn lại" cho từng đầu việc.
2. Dùng các công cụ còn lại trên việc thật để có log (chat cần `GAIC_CONNECTOR_URL`, xem `.claude/skills/ads-chat/SKILL.md`).
3. Mỗi tuần chép số lần từ `UsageLog` vào bảng và tính lại tỉ lệ chung.

## Xử lý khi dữ liệu bất thường

Những trường hợp tool đã tự xử lý, không phải làm tay:

| Bất thường | Tool xử lý thế nào |
|---|---|
| OpenAI rate limit, gen thiếu ảnh | Chờ đúng thời gian server báo, chỉ gen lại slot lỗi |
| Play Store đổi HTML, scraper hỏng | Đọc thẳng HTML làm đường dự phòng |
| Chữ localize trộn tiếng Anh hoặc sai bảng chữ | Dịch lại riêng dòng đó |
| Ad copy vượt giới hạn hoặc khối không tạo được campaign | Chặn, không gửi lên MKT, báo dòng lỗi |
| Template trùng tên trên MKT | Cập nhật template cũ thay vì tạo thêm |
| Video không dựng nhanh được (WebM, codec lạ, máy quá tải) | Chuyển sang dựng realtime nhưng vẫn đúng thời lượng |
| MKT trả lỗi giữa chừng khi push | Báo đúng bước hỏng; bấm lại không upload lại phần đã xong |
| Mã MKT hết hạn | Dừng, báo lấy mã mới |
