# Dữ liệu và bảo mật

Ba câu hỏi file này trả lời: dữ liệu nào được đưa ra công cụ ngoài, ai đọc được gì, và làm gì khi có người nghỉ.

## 1. Phân loại dữ liệu

| Mức | Nghĩa | Được đưa vào prompt AI (OpenAI, Anthropic)? |
|---|---|---|
| Công khai | Ai cũng xem được trên mạng | Được |
| Nội bộ | Sản phẩm làm việc của team, chưa chạy ra ngoài | Được, khi cần cho việc đang làm |
| Nhạy cảm | Số liệu kinh doanh: doanh thu, ROAS, chi phí | **Không** |
| Bí mật | Khoá, mật khẩu, mã đăng nhập | **Không bao giờ** |

## 2. Dữ liệu nào đi đâu

| Dữ liệu | Mức | Gửi ra ngoài | Nằm ở đâu |
|---|---|---|---|
| Tên app, mô tả, screenshot, icon trên store | Công khai | OpenAI (brief, gen ảnh, mascot), Anthropic (ad copy) | Không lưu trên server |
| Creative direction, brief, ảnh banner | Nội bộ | OpenAI (để gen ảnh); MKT System khi đẩy | IndexedDB của trình duyệt người dùng; thư mục `chat/runs/` (không commit) |
| Video ads | Nội bộ | Khung ảnh nhỏ 288px gửi OpenAI để tìm đoạn hướng dẫn; video lên S3 của MKT System | Dựng trong trình duyệt, không qua server |
| Ad copy | Nội bộ | Anthropic / Claude (viết, localize); MKT System | MKT System |
| Lời người sửa (vòng học) và bài học đã duyệt | Nội bộ | Lời sửa gửi OpenAI (gpt-4o-mini) khi bấm "Tìm bài học mới"; bài học đã duyệt đi vào prompt gen ảnh, brief, localize, ad copy | Tab `Feedback`, `BaiHoc` của sheet hệ thống |
| Report Google Ads, est ROAS, doanh thu (Phân tích Camp) | Nhạy cảm | **Không gửi cho AI.** Đọc bằng service account, xử lý bằng luật trong `lib/campDoctor.ts` | Google Sheet của người dùng; lịch sử 14 ngày trong trình duyệt |
| Danh sách tài khoản, mật khẩu | Bí mật | Không | Tab `Users` của sheet hệ thống. Mật khẩu là mã băm scrypt từ v7.2 |
| Log đăng nhập (email, IP, user agent), log sử dụng | Nội bộ | Không | Tab `LoginLog`, `UsageLog` của sheet hệ thống |
| Khoá API (OpenAI, Anthropic, Google Ads, service account), `NEXTAUTH_SECRET` | Bí mật | Không | Chỉ biến môi trường Vercel; với chat là Network secrets / biến môi trường của Environment Claude Code |
| Mã kết nối MKT `mktmcp_…` (của từng người, hết hạn sau ~24 giờ) | Bí mật | Chỉ tới MKT System | Cookie httpOnly trên web; biến `MKT_CONNECT_CODE` trong Claude Code |
| Link connector `…/api/mcp/gaic_…` (của từng người) | Bí mật | Không | Cài đặt connector của Claude; biến `GAIC_CONNECTOR_URL` trong Claude Code |
| Token Google Ads, YouTube | Bí mật | Chỉ tới Google | Cookie httpOnly |

Lưu ý: với `@adtemp` trên claude.ai, mã MKT được dán vào chat nên đi qua Anthropic. Mã chỉ sống ~24 giờ, nhưng nếu
được thì dùng `@adbanner` trong Claude Code, nơi mã nằm ở biến môi trường và không xuất hiện trong chat.

Quy tắc khi sửa code (đã ghi trong `skills/google-ads-studio/SKILL.md`): không hardcode khoá, không log giá trị khoá,
không đưa khoá vào commit hay PR, không đưa dữ liệu Nhạy cảm vào prompt.

## 3. Ai đọc được gì

Quyền nằm ở cột **Role** (cột E) của tab `Users`, đổi trong sheet là có hiệu lực trong vòng 5 phút.

| Role | Dùng được | Không dùng được | Vì sao |
|---|---|---|---|
| `ua` hoặc để trống | Mọi công cụ, duyệt bài học | | |
| `creative` | Gen Banner, Banner + Ad Copy, Ad Copy Studio, Outro Studio, MKT System, YouTube Upload, xem trang Bài học | Launch Camp, Phân tích Camp, duyệt bài học | Launch Camp tạo campaign thật (tiêu tiền); Phân tích Camp đọc doanh thu, ROAS; bài học đã duyệt đổi prompt của cả team |

Chặn ở hai lớp: API trả 403 (`requireCapability` trong `lib/apiAuth.ts`), sidebar ẩn công cụ không có quyền.
Luật nằm ở `lib/roles.ts`.

**Quản trị viên** là người có quyền sửa sheet hệ thống. Giữ danh sách này ít nhất có thể, vì sheet chứa danh sách
tài khoản. Service account của web cũng có quyền sửa (để ghi log và mã hoá mật khẩu).

## 4. Mật khẩu, nghỉ việc, chuyển bộ phận

Mỗi người tự đổi mật khẩu trên web (nút **Đổi mật khẩu** ở cuối sidebar): phải nhập đúng mật khẩu hiện tại, mật khẩu
mới tối thiểu 8 ký tự. Đổi xong, mọi phiên đăng nhập bằng mật khẩu cũ kết thúc (phiên đang dùng: ngay; máy khác: trong
vòng 5 phút). Admin đặt lại mật khẩu trong sheet cũng đăng xuất mọi phiên của người đó như vậy. Nhập sai mật khẩu hiện
tại 5 lần thì phải chờ 15 phút. Mọi lần đổi (thành công hoặc sai mật khẩu hiện tại) đều ghi ở `LoginLog`.

### Khi có người nghỉ việc hoặc chuyển bộ phận

Làm trong ngày làm việc cuối của người đó, theo thứ tự:

1. Tab `Users`: ghi `no` vào cột Active (không xoá dòng, để còn đối chiếu log). Trong vòng 5 phút: phiên web đang mở
   bị đăng xuất, link connector Claude của người đó ngừng chạy, bộ lệnh chat không ghi log dưới tên họ được nữa.
2. Nếu người đó có quyền sửa sheet hệ thống: gỡ quyền share.
3. MKT System: nhờ admin MKT tắt tài khoản. Mã `mktmcp_…` không thu hồi được, nó tự hết hạn sau tối đa 24 giờ.
4. Nếu người đó từng giữ hoặc xem một khoá dùng chung (OpenAI, Anthropic, Google Ads developer token, file JSON
   service account): tạo khoá mới, thay trên Vercel, redeploy, rồi xoá khoá cũ ở nhà cung cấp.
5. Google Ads: gỡ người đó khỏi tài khoản MCC (ngoài tool).
6. Ghi một dòng vào mục 6 bên dưới.

Đổi `NEXTAUTH_SECRET` là cách thu hồi mạnh nhất: mọi người bị đăng xuất và mọi link connector cũ hết hiệu lực
(mỗi người phải lấy link mới ở trang MKT System).

## 5. Kiểm tra hằng tháng

- [ ] Đối chiếu tab `Users` với danh sách team hiện tại; ai đã nghỉ mà Active chưa là `no` thì tắt.
- [ ] Tab `LoginLog`: một tên đăng nhập thất bại nhiều lần liên tiếp, hoặc nhiều lần "đổi mật khẩu thất bại", thì hỏi
      người đó và cân nhắc đặt lại mật khẩu.
- [ ] Cột Password không còn ô chữ thường (mọi ô bắt đầu bằng `scrypt$`). Ô còn chữ thường là người chưa đăng nhập
      lại từ v7.2: nhắc họ đăng nhập, hoặc đặt mật khẩu mới.
- [ ] Danh sách người có quyền sửa sheet hệ thống vẫn đúng.

## 6. Lịch sử siết quyền

Mỗi lần phát hiện rủi ro và sửa, ghi một dòng.

| Ngày | Phát hiện | Rủi ro | Đã làm | Version |
|---|---|---|---|---|
| 2026-11-18 | Mật khẩu trong tab `Users` được chấp nhận ở dạng chữ thường, hoặc SHA-256 với một salt chung viết trong code | Ai mở được sheet là đọc được mật khẩu | Mã băm scrypt, salt riêng từng người; mật khẩu cũ tự chuyển sang mã băm ở lần đăng nhập kế tiếp | v7.2 |
| 2026-11-18 | Log đăng nhập ghi vào tab `Sheet1` đã không còn, lỗi bị bỏ qua | Không có lịch sử ai đăng nhập | Ghi vào tab `LoginLog` (tự tạo), ghi cả lần thất bại, lỗi ghi log hiện trong log server | v7.2 |
| 2026-11-18 | Log đăng nhập ghi kiểu `USER_ENTERED` | Tên đăng nhập hoặc user agent bắt đầu bằng `=` thành công thức trong sheet | Ghi kiểu `RAW` | v7.2 |
| 2026-11-18 | Tắt người trong tab `Users` chỉ chặn lần đăng nhập mới | Phiên web đang mở vẫn dùng được tới 30 ngày | Kiểm tra lại tab `Users` trong phiên, tắt là bị đăng xuất trong vòng 5 phút | v7.2 |
| 2026-11-18 | Không có phân quyền | Ai đăng nhập cũng tạo được campaign thật và xem được doanh thu | Cột Role, chặn Launch Camp và Phân tích Camp với role `creative` | v7.2 |
| 2026-11-18 | Connector Claude cho qua mọi link khi đọc tab `Users` bị lỗi | Người đã bị tắt vẫn dùng được connector lúc Google Sheets gặp sự cố | Dùng bản tab `Users` đọc được gần nhất | v7.2 |
| 2026-11-18 | Connector Claude so tên `x@ads-gen.internal` với username `x` | Chặn nhầm tài khoản không có email | Đổi về đúng username trước khi so | v7.2 |
| 2026-11-18 | Lượt chạy từ chat Claude Code ký tên `chat@localhost`, không ghi log | Không biết ai đã đẩy gì lên MKT | Ghi đúng tên người qua link connector, ghi vào `UsageLog` | v7.2 |
| 2026-11-18 | Người dùng không tự đổi được mật khẩu; đổi mật khẩu không đăng xuất các phiên cũ | Lộ mật khẩu thì phải nhờ admin, phiên của kẻ lạ vẫn chạy tiếp | Nút Đổi mật khẩu trên web; đổi hoặc đặt lại mật khẩu thì mọi phiên cũ kết thúc trong 5 phút; giới hạn 5 lần sai mật khẩu hiện tại / 15 phút | v7.2 |

## 7. Rủi ro còn lại

| Rủi ro | Vì sao chưa sửa | Giảm thiểu hiện tại |
|---|---|---|
| Mã MKT `mktmcp_…` không thu hồi được | Giới hạn của MKT System | Hết hạn sau tối đa 24 giờ |
| Không thu hồi riêng được một link connector | Link ký bằng `NEXTAUTH_SECRET`, không lưu danh sách | Tắt người đó trong tab `Users`, hoặc đổi `NEXTAUTH_SECRET` |
| Chưa khoá tài khoản sau nhiều lần đăng nhập sai | Chưa làm | Mọi lần thất bại được ghi ở `LoginLog`, xem hằng tháng |
| Khi chưa từng đọc được tab `Users` (Google Sheets lỗi ngay từ đầu), connector và kiểm tra phiên cho qua | Không để cả team bị khoá vì sự cố của Google | Hết sự cố là kiểm tra lại trong 5 phút |
