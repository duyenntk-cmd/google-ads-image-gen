---
name: google-ads-studio
description: Bộ công cụ Google Ads cho app mobile tại https://google-ads-image-gen.vercel.app — gồm Gen Banner (cắt ảnh từ video ads), AI Banner (gen 20 creative App campaign từ URL store, localize, lưu lịch sử), Ad Copy Studio (keyword + 5 tiêu đề/5 mô tả + localize), Launch Camp (tạo campaign Google Ads), YouTube Upload (up hàng loạt video unlisted lấy link chạy ads). Dùng skill này khi người dùng hỏi cách dùng tool, gặp lỗi khi dùng, muốn biết một tính năng nằm ở đâu, muốn sửa/phát triển code của repo duyenntk-cmd/google-ads-image-gen, hỏi về chi phí mỗi lượt gen, hỏi kích thước ảnh Google App campaign, hoặc nói "gen banner", "gen ảnh quảng cáo", "tạo creative", "viết ad copy", "tìm keyword", "localize quảng cáo", "up video unlisted", "tạo campaign".
---

# Google Ads Studio

Web app Next.js, deploy trên Vercel, đăng nhập bằng Google. Năm công cụ trong một sidebar.

**Quy tắc bắt buộc về khoá:** mọi API key và secret CHỈ nằm trong Environment Variables của
Vercel, KHÔNG BAO GIỜ viết vào code. Khi sửa code, không hardcode, không log giá trị khoá,
không đưa khoá vào commit message hay PR.

## Năm công cụ

| Sidebar | Việc | Chạy bằng |
|---|---|---|
| 🎨 Gen Banner | Upload video ads → cắt frame → resize ra nhiều kích thước GDN | canvas trong trình duyệt |
| ✨ AI Banner | URL store → 20 creative App campaign hoàn chỉnh | OpenAI ảnh + GPT-4o-mini |
| 🎯 Ad Copy Studio | Keyword → ad copy cho keyword đó → localize | Claude (Anthropic) |
| 🚀 Launch Camp | Tạo App campaign thật trên tài khoản Google Ads | Google Ads API |
| ▶️ YouTube Upload | Up hàng loạt video Unlisted, lấy link chạy ads | YouTube Data API |

Chi tiết từng công cụ: `references/tools.md`.
Kiến trúc, API route, biến môi trường, quy ước code: `references/architecture.md`.

## Ba điều hay bị hỏi nhất

**Kích thước ảnh App campaign.** App campaign KHÔNG nhận kích thước cố định, nó nhận
image asset theo 3 TỈ LỆ: 1.91:1 (1200×628), 1:1 (1200×1200), 4:5 (1200×1500).
Tối đa 20 ảnh/ad group, ≤5MB, PNG hoặc JPG. 9:16 là tỉ lệ VIDEO, không phải tỉ lệ ảnh.
AI Banner chia 20 slot thành 7 + 7 + 6 theo đúng ba tỉ lệ đó.

**Tiền mỗi lượt gen.** Tính theo chất lượng ảnh, hiện trên nút trước khi bấm:
low ~0,006$/ảnh · medium ~0,053$/ảnh · high ~0,211$/ảnh (quy đổi 26.000₫/$).
Bộ 20 ảnh chất lượng high ≈ 28.000₫. Gen lại 1 ảnh ≈ 1.400₫. Localize sang thị trường
khác KHÔNG tốn tiền ảnh — chỉ vẽ lại chữ lên ảnh cũ, vài trăm đồng tiền dịch.

**Deploy xong không thấy thay đổi.** Nhánh production trên Vercel không phải nhánh đang
làm việc, nên mỗi deployment phải bấm **Promote to Production** thủ công thì mới lên
domain chính.

## Chữ trên banner — điều quan trọng nhất

Chữ trên banner (headline, phụ đề, CTA, logo, Play badge) do **canvas vẽ sau**, không phải
model vẽ. Nhờ vậy chữ luôn sắc nét và giống hệt nhau ở cả 20 size. Model chỉ vẽ phần
tranh và phải chừa trống vùng dành cho chữ.

Hệ quả bắt buộc phải biết: chữ **bên trong màn hình điện thoại** trong ảnh là pixel do
model vẽ. Localize đổi được chữ canvas, KHÔNG đổi được chữ trong mockup điện thoại.
Muốn cả mockup đúng ngôn ngữ thì phải gen bộ mới với ngôn ngữ đó.

## Thứ tự thao tác ở AI Banner (quan trọng)

Chọn **Thị trường + Ngôn ngữ TRƯỚC**, rồi mới bấm ✨ Auto Prompt. Creative direction được
viết CHO một thị trường; chọn thị trường sau khi đã có prompt thì chữ trên banner dễ ra
sai ngôn ngữ. App có cảnh báo màu cam khi hai thứ này lệch nhau.

## Khi người dùng báo lỗi

Đọc `references/troubleshooting.md` — có sẵn cách xử lý cho: gen ra thiếu ảnh (rate limit),
chữ đè lên nhân vật, hai nhân vật trong một ảnh, chữ sai ngôn ngữ, Auto Prompt không chạy,
lấy dữ liệu store thất bại, Launch Camp không kết nối được.
