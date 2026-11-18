# MKT report → Discord

Gửi về kênh Discord cá nhân lúc **7:00, 14:00, 20:00** (giờ Việt Nam), mỗi sản phẩm một khối:

| Chỉ số | Cách tính | Phạm vi |
|---|---|---|
| Spend | tổng `total_spen` | mọi quốc gia, mọi kênh |
| ROAS | est revenue D0 (`sum_metric_est_cohort_revenue_d0`) / spend | mọi quốc gia |
| CPI US | spend US / install MMP US | US |
| LTV US | est revenue D0 US / install MMP US | US |

Mỗi chỉ số kèm số của **lần chạy cùng giờ hôm qua** và mức thay đổi: 🟢 tốt lên, 🔴 xấu đi (CPI tăng là 🔴),
🔼🔽 cho spend. ROAS đổi theo điểm phần trăm (pp). Màu khối: xanh khi ROAS tăng so với hôm qua, đỏ khi giảm.

Sản phẩm: `AAP861, APL789, AAP887, AIP016, AAP883` (sửa ở dòng `PRODUCTS` trong
`.github/workflows/mkt-report.yml`).

Số liệu lấy từ cùng API mà trang **Intraday** của MKT System dùng, nên khớp với số bạn thấy trên trang đó
(chọn ngày hôm nay, giờ Việt Nam).

## Cài đặt (làm một lần)

1. **Tạo webhook Discord** ở kênh cá nhân: Discord → kênh → ⚙️ Edit Channel → Integrations → Webhooks →
   New Webhook → Copy Webhook URL.
2. **Thêm 2 secret** trên GitHub: repo → Settings → Secrets and variables → Actions → New repository secret
   - `DISCORD_WEBHOOK_URL`: URL vừa copy.
   - `MKT_CONNECT_CODE`: mã `mktmcp_…` ở MKT System → Profile → Kết nối Claude.
3. **Merge** nhánh có workflow này vào `main`: GitHub chỉ chạy lịch của workflow nằm trên nhánh mặc định.
4. **Chạy thử**: tab Actions → *MKT report → Discord* → Run workflow
   - mode `debug` trước: Discord nhận danh sách sản phẩm tìm được, các cột dữ liệu và giá trị quốc gia.
     Kiểm tra cả 5 mã đều tìm thấy, và `country_name` có US.
   - rồi mode `send`: Discord nhận report thật.

## Việc hằng ngày: thay mã MKT

Mã kết nối MKT chỉ sống **24 giờ** kể từ lúc đăng nhập MKT System và không gia hạn được. Mỗi ngày cần lấy
mã mới và cập nhật secret `MKT_CONNECT_CODE` (Settings → Secrets → Actions → `MKT_CONNECT_CODE` → Update).

- Report báo trước ⚠️ khi mã sẽ hết hạn trước lần chạy kế tiếp.
- Hết hạn rồi thì Discord nhận ❌ thay cho report.
- Mẹo: đăng nhập MKT và lấy mã khoảng 7:30–13:30, mã sẽ phủ được 14h, 20h hôm đó và 7h sáng hôm sau.

Muốn bỏ hẳn bước này: nhờ team MKT System cấp một token dài hạn (hoặc API key) chỉ đọc report, rồi đổi phần
đăng nhập trong `report.mjs` (hàm `mktClient`).

## Lưu ý

- **Repo đang public**: log Actions ai cũng xem được. Script không in số liệu ra log. Số liệu các lần chạy (để
  so sánh hôm sau) lưu trong GitHub Actions cache, được mã hoá AES-256-GCM bằng khoá suy ra từ webhook (hoặc
  secret `SNAPSHOT_KEY` nếu đặt). Đổi webhook thì lịch sử cũ không đọc được nữa: hôm đó report chưa có số so sánh.
- Lần đầu chạy ở mỗi khung giờ chưa có số hôm qua; từ hôm sau mới có.
- "Cùng giờ hôm qua" = lần chạy gần nhất với đúng 24 giờ trước (lệch tối đa ±3 giờ). Lịch GitHub có thể trễ vài
  phút, nên giờ so sánh hiện rõ trong report.
- Repo public không có commit nào trong 60 ngày thì GitHub tự tắt lịch chạy: vào tab Actions bật lại.
- Muốn đổi cột doanh thu (ví dụ dùng `total_revenue` thay cho est D0): thêm `REVENUE_FIELD: total_revenue`
  vào `env` của bước *Gửi report*.

## Chạy trên máy (không gửi Discord)

```bash
MKT_CONNECT_CODE=mktmcp_... MODE=dry node scripts/mkt-report/report.mjs
```

`MODE=dry` in nội dung tin nhắn ra màn hình. Đừng dùng `dry` trong GitHub Actions: log là public.
