# 📊 Phân tích Camp — khung quyết định

Trang phân tích App campaign tROAS. Code: `lib/campDoctor.ts` (luật, thuần, test được),
`components/CampDoctor.tsx` (giao diện), `app/api/camp-sheets/route.ts` (đọc Google Sheets
bằng service account của web).

## Dữ liệu vào

| File | Lấy cột | Ghi chú |
|---|---|---|
| Report campaign GG Ads (export) | Campaign, Budget, Status, Status reasons, Optimization score, Avg. target ROAS, Conversions, Impr., CTR, Cost | Dòng "October 16, 2026 - October 16, 2026" cho biết ngày của report |
| Report data system | campaign_id, campaign_name, **est_roas**, total_spen, total_revenue, sum_metric_est_cohort_revenue_d0, total_install_mmp, cpi | est_roas = est revenue d0 / spend |

- Ghép theo **tên campaign** (file GG Ads không có ID).
- Hai file phải **cùng ngày**. Lệch ngày thì cost GG và spend system lệch hẳn nhau
  (ví dụ $453 so với $248), và kết luận sai.
- Số đọc được theo kiểu export của Google: "1,4", "110%", "--".

## Mục tiêu

**Target ROAS D0 = 100%.** Luật so `est_roas` (system) với target này.
**tROAS của camp** chỉ là con số được đề xuất chỉnh lên hoặc xuống.

## Thứ tự xét

1. **Asset bị policy:** *most ads limited by policy* → 🔴 thay asset (nút sang Banner + Ad Copy);
   *some ads…* → 🟡.
2. **Learning:** không chỉnh budget hay tROAS (học lại từ đầu). Đợi 5–7 ngày.
3. **Không có est ROAS:** kiểm tra tên camp có khớp không.
4. **Chưa đủ dữ liệu:** cost < max($5, 10% budget) và conversion < 30 → chưa kết luận.
5. **Theo ROAS** (bảng dưới).
6. **Thêm:** CTR < 1% trên ≥ 2.000 impression → làm mới creative.
   Optimization score < 85 → xem tab Recommendations của Google.

## Tăng budget bao nhiêu khi camp tiêu hết ngân sách và ROAS tốt

| Tình trạng | Mức tăng | Cách xử lý |
|---|---|---|
| ROAS vừa đạt target, mới ổn định (< 3 ngày) | **+10–15%** | Tăng thận trọng |
| ROAS tốt, tiêu hết budget liên tục 3–7 ngày | **+15–20%** | Scale từng bước |
| ROAS ≥ 120% target, ổn định ≥ 3 ngày | **+20–30%** | Có thể tăng mạnh hơn nếu chấp nhận biến động |
| ROAS dao động mạnh, mới có vài ngày tốt | **0–10% / giữ** | Chờ thêm dữ liệu |
| ROAS dưới target hoặc lợi nhuận giảm | **Không tăng** | Tối ưu trước khi scale |

- "Tiêu hết budget" = cost ≥ 90% budget, hoặc *limited by budget* với cost ≥ 50%.
- Cost < 50% budget mà vẫn *limited by budget* → nhiều khả năng là report giữa ngày
  → chờ hết ngày rồi mới tăng.
- "Dao động" = trong 7 ngày gần nhất có ngày dưới target, hoặc CV ROAS > 30%.

## Khi nào tăng budget, khi nào chỉnh tROAS

| Tình huống | Hành động ưu tiên |
|---|---|
| Tiêu hết budget, ROAS tốt, muốn thêm volume | **Tăng budget** |
| Tiêu ít hơn budget, ROAS tốt | **Kiểm tra tROAS có quá cao** → hạ tROAS ~10% (dùng Bid Simulator) |
| Tiêu hết budget nhưng ROAS thấp | **Không scale**; kiểm tra chất lượng user, siết tROAS |
| ROAS tốt nhưng conversion < 10 | Kiểm tra tracking, event tối ưu, dữ liệu học máy |
| Đã tăng budget nhưng cost không tăng | Kiểm tra giới hạn đấu giá, tROAS, quy mô thị trường |

tROAS càng cao thì Google lọc user càng chặt. Hạ tROAS để mở rộng phân phối là việc
**khác** với tăng budget.

## Dưới target

| est ROAS / target | Hành động |
|---|---|
| 80–100% | Không tăng budget, theo dõi 1–2 ngày |
| 50–80% | Nâng tROAS +10% |
| < 50% | Giảm budget −20% và nâng tROAS +15%; 3 ngày liên tiếp < 50% → cân nhắc tạm dừng |

Mỗi lần chỉnh tối đa khoảng 20% (riêng trường hợp vượt target rõ rệt và ổn định thì tới 30%).

## Lịch sử nhiều ngày

Mỗi report chỉ có 1 ngày. Mỗi lần phân tích, trang lưu số liệu ngày đó vào localStorage
(`camp_doctor_history`, theo từng camp, tối đa 14 ngày). Từ đó trang tính được chuỗi ngày
"đạt target + hết budget", độ dao động và "tăng budget mà volume không tăng".
Lịch sử chỉ có trên trình duyệt đã dùng để phân tích, nên cần phân tích đều mỗi ngày.

Ngưỡng nằm trong `RULES` ở `lib/campDoctor.ts` (`targetD0`, `fullSpend`, `stableDays`,
`volatileCv`, `scaleAt`, `tightenBelow`, `cutBelow`…).
