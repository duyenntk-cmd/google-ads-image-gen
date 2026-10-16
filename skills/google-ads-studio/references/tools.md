# Năm công cụ, chi tiết

## 🎨 Gen Banner
Upload video quảng cáo → app trích frame ngay trong trình duyệt → chọn frame đẹp nhất →
GPT viết brief → canvas vẽ overlay → xuất nhiều kích thước GDN + ZIP.
Không gọi model tạo ảnh, nên gần như không tốn tiền.
Dành cho: có sẵn video ads, muốn ra ảnh tĩnh nhanh.

## ✨ AI Banner — công cụ chính cho App campaign

Luồng: URL store → **Kiểm tra** (xác nhận đúng app trước khi tiêu tiền) →
chọn **Thị trường + Ngôn ngữ** → **✨ Auto Prompt** (GPT đọc mô tả + screenshot thật rồi
viết creative direction bằng tiếng Việt, riêng phần chữ in lên banner viết bằng ngôn ngữ
thị trường) → mascot (tự tìm trong screenshot, không có thì tự tạo, hoặc tự upload) →
gen → duyệt → localize.

**Ba chế độ gen**, giá hiện ngay trên nút:
- 1 ảnh duyệt trước — rẻ nhất, xem bố cục
- 3 ảnh mỗi tỉ lệ 1 ảnh
- Đủ bộ 20 creative

**20 creative = 7 góc nhìn khác nhau** (hero, feature, benefit, lifestyle, social proof,
bold minimal, discovery) trải trên 3 tỉ lệ. Mỗi ảnh gen ĐỘC LẬP đúng kích thước thật,
không co kéo từ ảnh gốc. Cả 20 đều là banner hoàn chỉnh có đủ chữ.

**Mascot là mỏ neo nhất quán:** một nhân vật duy nhất, dùng lại làm ảnh tham chiếu cho cả
20 lần gen, nên nhân vật giống nhau xuyên suốt bộ.

**Sửa sau khi gen** — ba mức, đều dùng lại brief + mascot đã trả tiền:
- Ô sửa lớn trên lưới: áp cho cả bộ
- Ô sửa dưới mỗi ảnh: chỉ ảnh đó, không đổi 19 ảnh còn lại
- Nút ↻ trên mỗi ảnh: gen lại y nguyên yêu cầu cũ
- Nút cam "Gen lại N ảnh lỗi": chỉ gen lại phần thất bại

**Localize:** chọn nhiều ngôn ngữ trong dropdown có ô tìm kiếm → mỗi thị trường ra một bộ
20 banner + ZIP riêng. Chỉ vẽ lại chữ lên ảnh cũ nên không tốn tiền gen ảnh.

**Lịch sử gen:** mỗi lần gen tự lưu ảnh gốc + brief vào IndexedDB của trình duyệt. Bấm
"Mở lại" là dựng lại cả bộ và localize được bất cứ lúc nào. Dữ liệu nằm trong trình duyệt
— đổi máy hoặc xoá site data là mất.

## 🎯 Ad Copy Studio
Một trang gộp từ ba trang cũ (Keywords, Ad Copy, Localize).

1. Dán URL app → 20 keyword, **volume cao nhất lên đầu**, kèm competition, CPC, intent.
   Nút "＋ Xem thêm 20" gửi kèm danh sách đang có làm danh sách loại trừ.
2. Bấm một keyword → bên phải ra **5 tiêu đề + 5 mô tả + 5 CTA viết CHO keyword đó**
   (keyword hoặc biến thể phải xuất hiện trong ít nhất 3/5 tiêu đề).
   Mỗi dòng đếm ký tự, vượt giới hạn Google thì hiện đỏ: tiêu đề 30, mô tả 90, CTA 15.
3. Localize bộ copy sang nhiều thị trường, có nút chép từng dòng hoặc chép hết.

Số volume và CPC là **ước lượng do model đưa ra**, không phải số thật từ Google Keyword
Planner. Muốn số thật phải nối API Keyword Planner, cần tài khoản có Basic Access.

## 🚀 Launch Camp
Kết nối tài khoản Google Ads qua OAuth → chọn tài khoản → điền tên campaign, App ID,
ngân sách/ngày, headline, description → chọn banner để upload → tạo App campaign thật.
Bộ ảnh từ AI Banner được ưu tiên hiện ra để chọn.

Cần Developer Token ở mức **Basic Access**. Ở mức Explorer (Test) sẽ không đọc được tài
khoản thật — app báo rõ lỗi này.

## ▶️ YouTube Upload
Đăng nhập Google → chọn nhiều video → up hàng loạt ở chế độ **Unlisted** và
**Not made for kids** → trả về danh sách link YouTube để dán vào Google Ads campaign.
Chú ý quota YouTube Data API: mỗi video tốn ~1.600 đơn vị, quota mặc định 10.000/ngày,
tức khoảng 6 video/ngày nếu chưa xin tăng quota.
