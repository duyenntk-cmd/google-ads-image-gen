# Lỗi thường gặp

## Gen ra thiếu ảnh (ví dụ 17/20)
Rate limit của OpenAI. Meter "input images per minute" tính riêng với meter số request, mà
mỗi lần gen gửi kèm mascot + screenshot. App đã tự chờ và thử lại theo thời gian server
báo, nhưng vẫn có thể rớt. Cách xử lý: bấm nút cam **"Gen lại N ảnh lỗi"** — chỉ trả tiền
cho phần thiếu.

## Chữ đè lên nhân vật / lên màn hình điện thoại
Prompt yêu cầu model chừa hẳn một dải trống cho chữ, coi như mép ngoài khung hình. Đây là
chỉ dẫn cho model, không phải đảm bảo tuyệt đối. Ảnh nào lỗi thì bấm ↻ hoặc ghi yêu cầu
vào ô sửa dưới ảnh đó, ~1.400₫.

KHÔNG tự động dò chủ thể rồi đẩy layout: cách đó đã thử ba lần, kết quả xấu và chủ tài
khoản đã bác bỏ.

## Hai nhân vật trong một ảnh
Trước đây do prompt vừa đưa ảnh mascot tham chiếu vừa đưa câu mô tả một nhân vật khác.
Đã sửa: ảnh tham chiếu thắng tuyệt đối, câu mô tả chỉ còn giá trị về hành động và bối
cảnh. Nếu vẫn lọt, gen lại riêng ảnh đó.

## Chữ ra sai ngôn ngữ
Thường do bấm Auto Prompt trước rồi mới đổi thị trường — creative direction cũ vẫn giữ chữ
của thị trường cũ. App hiện cảnh báo cam khi lệch; bấm **Auto Prompt lại** sau khi đổi
thị trường. Ngoài ra còn một lớp kiểm tra cuối tự dịch lại nếu phát hiện sai ngôn ngữ.

Riêng chữ trong mockup điện thoại là pixel model vẽ, localize không đổi được.

## Auto Prompt không chạy / báo lỗi
Kiểm tra URL store có đúng không, và `OPENAI_API_KEY` đã có trên Vercel chưa. Nếu lấy
screenshot thất bại, app vẫn chạy tiếp nhưng kém sát hơn và báo cảnh báo vàng.

## Lấy dữ liệu store thất bại
Play Store đổi HTML thường xuyên nên thư viện scraper có thể hỏng. App có đường dự phòng
đọc thẳng HTML. Nếu vẫn lỗi, vẫn gen được nhưng brief sẽ đoán nhiều hơn.

## Launch Camp không kết nối được
- Thiếu biến `GOOGLE_ADS_*` trên Vercel
- Developer Token còn ở mức Explorer (Test) — phải nâng lên Basic Access
- Redirect URI trong Google Cloud Console phải khớp `NEXTAUTH_URL` + `/api/auth/google-ads/callback`

## Deploy rồi mà web không đổi
Bấm **Promote to Production** trên Vercel. Nhánh production không phải nhánh đang làm việc.
