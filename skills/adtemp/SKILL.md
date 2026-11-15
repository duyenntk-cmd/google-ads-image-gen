---
name: adtemp
description: Tạo ad template Google (App campaign) cho app mobile ngay trong chat rồi đẩy lên MKT System, thay cho các bước trên trang Banner + Ad Copy. LUÔN dùng skill này khi người dùng gõ "@adtemp" (vd "@adtemp https://play.google.com/store/apps/details?id=... VN, US"), hoặc nhờ "tạo ad template", "viết ad copy rồi đẩy MKT", "gen ad template cho app", "tạo template Google++ cho thị trường ...". Cần connector "Google Ads Studio" (link lấy ở trang MKT System của web google-ads-image-gen).
---

# @adtemp: ad template Google từ chat

Skill này điều khiển connector **Google Ads Studio** (MCP của web google-ads-image-gen). Mọi việc ghi lên MKT System đi qua connector; phần viết và localize ad copy là việc của bạn.

## Cú pháp

```
@adtemp <link App Store / Google Play> <thị trường> [góc/ghi chú] [banner]
```

- Thị trường: mã ISO, cách nhau bởi dấu phẩy (VN, US, TH, ID, PH, IN, BR...).
- Góc/ghi chú: tuỳ chọn, vd "góc: tạo ảnh AI ngày Tết", "3 khối", "giọng trẻ trung".
- `banner`: tuỳ chọn, kèm link gen banner trên web với cùng số Gen.

Thiếu link hoặc thị trường thì hỏi lại đúng phần thiếu, không đoán.

## Quy trình

1. Kiểm tra connector Google Ads Studio đã bật trong chat. Chưa có thì hướng dẫn: web → trang **MKT System** → "Lấy link connector của tôi" → Claude Settings → Connectors → Add custom connector → dán link.
2. Gọi `get_guide` và làm đúng quy trình trong đó. Tóm tắt:
   1. `app_info(store_url)`: đọc app làm gì, cho ai.
   2. Xin **mã kết nối MKT** (`mktmcp_…`, MKT System → Profile → **Kết nối Claude**, hiệu lực ~24h) nếu trong chat chưa có. Gọi `mkt_status` và nói rõ đang dùng mã của email nào.
   3. Tự viết ad copy cho từng thị trường: mặc định 3 khối/thị trường, mỗi khối 5 headline (≤30 ký tự, khác nhau) và 5 description (≤90 ký tự). Viết bằng ngôn ngữ và chữ viết của thị trường, không trộn tiếng Anh, không CTA.
   4. `check_ad_copy`: sửa hết lỗi, xem cả cảnh báo.
   5. `mkt_next_gen` để có số Gen và tên template.
3. **Hiện nháp, chưa đẩy.** Mỗi thị trường một bảng: cột nội dung và cột số ký tự, tách headline/description theo khối. Ghi tên template sẽ tạo, ví dụ `Ad Template 20261115 Gen3 VN`. Kết thúc bằng: *Gõ **ok** để đẩy lên MKT, hoặc nói cần sửa gì.*
4. Người dùng sửa thì sửa, chạy lại `check_ad_copy`, hiện lại phần đã đổi.
5. Chỉ khi người dùng đồng ý ("ok", "đẩy đi", "được"...) mới gọi `mkt_push_ad_templates` với đúng nội dung và đúng số Gen đã hiện. Không tự đẩy khi chưa được đồng ý.
6. Báo kết quả từng template (tạo mới / cập nhật / lỗi). Muốn sửa sau khi đã đẩy: đẩy lại cùng Gen, template trùng tên được cập nhật, không tạo trùng.
7. Lệnh có `banner`: gọi `banner_link` với link store, thị trường chính và cùng Gen, đưa link cho người dùng. Giải thích ngắn: banner gen trên web, creative sẽ mang tag `<ngày> Gen<n>` nên khớp với template vừa tạo.

## Lưu ý

- Mã MKT hết hạn (tool báo hết hạn) thì xin mã mới, không thử lại bằng mã cũ.
- Không bịa tính năng app không có; dựa trên mô tả store từ `app_info`.
- Chỉ tên app và chữ "AI" được giữ nguyên tiếng Anh trong bản localize.
- Một lệnh có thể nhiều thị trường: mỗi thị trường là một template riêng, cùng một Gen.
