# Sổ quy tắc

Mọi quy tắc tool đang dùng: nằm ở đâu (một nguồn duy nhất), ai dùng, lúc nào dùng, đổi thế nào, và lịch sử đổi.
Quy tắc chia thành 5 tầng theo **ai có quyền đổi** và **đổi thường xuyên tới đâu**. Tầng trên ít đổi, tầng dưới đổi
thường xuyên.

| Tầng | Là gì | Ai quyết | Đổi bao lâu một lần | Đổi bằng cách nào |
|---|---|---|---|---|
| 1. Nền tảng | Luật của Google Ads, MKT System, model tạo ảnh | Bên ngoài | Khi nền tảng đổi | Sửa code, deploy |
| 2. Tích hợp | Quy ước đặt tên để Google++ tự ghép creative với template | Team + MKT System | Hiếm | Sửa code, deploy |
| 3. Nghiệp vụ | Cách team làm quảng cáo: thị trường, cách viết, bố cục banner, khung budget/tROAS | Trưởng nhóm UA | Vài tuần / lần | Sửa code, deploy, ghi vào lịch sử bên dưới |
| 4. Bài học | Lỗi lặp lại AI tự gom từ các lần người sửa, người duyệt mới áp dụng | Role `ua` | Hằng tuần | Trang **🧠 Bài học**, không cần deploy |
| 5. Từng lần chạy | Creative direction, yêu cầu sửa riêng, thị trường của lượt đó | Người đang làm | Mỗi lượt | Gõ trên web / trong chat; không lưu thành quy tắc |

Khi hai tầng nói khác nhau, tầng dưới thắng trong phạm vi của nó: yêu cầu sửa riêng (tầng 5) thắng bài học (tầng 4),
bài học thắng mặc định nghiệp vụ (tầng 3). Tầng 1 và 2 không tầng nào được phá (ví dụ không bài học nào được cho phép
headline quá 30 ký tự).

Quyền truy cập (ai dùng được công cụ nào) không nằm ở đây mà ở tab `Users` và `lib/roles.ts`, xem
[du-lieu-va-bao-mat.md](du-lieu-va-bao-mat.md).

## Tầng 1. Nền tảng

| Quy tắc | Giá trị | Nguồn duy nhất | Dùng ở | Lúc nào |
|---|---|---|---|---|
| Khối ad copy tạo được campaign | 2–5 headline khác nhau ≤30 ký tự, 1–5 description ≤90 ký tự, tối đa 5 khối | `validateAdContents` trong `lib/mktClient.ts` | Web, connector (`check_ad_copy`, `mkt_push_ad_templates`), chat | Trước khi gửi ad template lên MKT: còn lỗi là không gửi |
| Tỉ lệ ảnh App campaign | 1.91:1, 1:1, 4:5; 20 ảnh / ad group; ≤5MB | `RATIO_SPECS`, `APP_CREATIVES` trong `lib/adFormats.ts` | Web, chat | Chọn kích thước gen và xuất ảnh |
| Kích thước model tạo ảnh nhận | Cạnh chia hết 16, tỉ lệ 1:3–3:1, cạnh ≤3840, 655.360–8.294.400 pixel | `planGenSize` trong `lib/adFormats.ts` | `/api/banner-generate` | Mỗi ảnh |
| Định dạng video MKT nhận | MP4/MOV | `public/outro-studio/index.html` | Outro Studio | Khi push |

## Tầng 2. Tích hợp (Google++ trên MKT System)

| Quy tắc | Giá trị | Nguồn duy nhất | Dùng ở |
|---|---|---|---|
| Tag creative | Đúng 2 tag: `<YYYYMMDD> Gen<n>` và mã thị trường viết hoa | Trang Banner + Ad Copy (`cbPushAll` trong `app/page.tsx`), `pushCreatives` trong `chat/studio.mjs` | Web, chat |
| Tên ad template | `Ad Template <YYYYMMDD> Gen<n> <THỊ TRƯỜNG>` | `templateName` trong `lib/adTemplates.ts` | Web, connector, chat |
| Số Gen | Gen cao nhất trong ngày trên MKT + 1; creative và template cùng một Gen | `genOf` trong `lib/adTemplates.ts`, `nextGen` trong `app/api/mcp/[key]/route.ts` | Web, connector, chat |
| So tên template | Bỏ qua hoa/thường, dấu cách, `_`, `[ ]`; trùng thì cập nhật, không tạo thêm | `normTplName` trong `lib/adTemplates.ts` | Web, connector, chat |
| Ngày | Giờ Việt Nam | `todayVN` trong `lib/adTemplates.ts` | Mọi chỗ đặt tên |
| Campaign Template | `Campaign Template <THỊ TRƯỜNG>`, tạo tay một lần trên MKT | Ngoài tool | |
| Link mở MKT | Trang Creative lọc theo tag, 30 ngày | `lib/mktLink.ts`, ghi đè bằng biến `MKT_SYSTEM_URL` | Web, Outro Studio, chat |

## Tầng 3. Nghiệp vụ của team

| Quy tắc | Giá trị hiện tại | Nguồn duy nhất | Dùng ở | Lúc nào |
|---|---|---|---|---|
| Thị trường và ngôn ngữ bản địa | Danh sách mã thị trường → tên nước, ngôn ngữ | `MARKETS` trong `lib/adTemplates.ts` | Web, connector, chat | Chọn ngôn ngữ cho brief, localize, ad copy |
| Viết ad copy | Không CTA; không hứa điều app không làm; viết bằng chữ bản địa, không trộn tiếng Anh; chỉ tên app và "AI" giữ tiếng Anh; mặc định 3 khối × 5 headline × 5 description | `GUIDE` trong `app/api/mcp/[key]/route.ts` (chat, connector); prompt trong `app/api/adcopy/route.ts` và `app/api/localize/route.ts` (web) | Web, connector, chat | Viết và localize ad copy |
| Kiểm tra chữ bản địa | Dòng chủ yếu là chữ Latin ở thị trường dùng chữ khác thì báo / dịch lại | `mostlyLatin`, `scriptOf` trong `lib/adCopyCheck.ts` | Web, connector | Sau khi viết, sau khi localize |
| Chữ in trên banner | headline ≤30, phụ đề ≤45, CTA ≤12, tagline ≤32; do canvas vẽ, model không vẽ chữ | `BRIEF_SCHEMA` trong `app/api/banner-concept/route.ts`, `LIMITS` trong `app/api/banner-localize/route.ts`, `lib/abRender.ts` | Web, chat | Viết brief, localize, vẽ chữ |
| Bố cục ảnh nền | Một nhân vật duy nhất; chừa trống vùng chữ; không chữ, logo, badge trong tranh; tránh tay xoè | Prompt `buildPrompt` trong `app/api/banner-generate/route.ts` | Web, chat | Mỗi ảnh |
| 7 góc creative | hero, feature, benefit, lifestyle, social, bold, discovery | `ANGLES` trong `lib/adFormats.ts` | Web, chat | Mỗi slot trong bộ 20 ảnh |
| Chất lượng và giá ảnh | low ~$0,006 · medium ~$0,053 · high ~$0,211 / ảnh | `AB_COST_PER_IMAGE` trong `app/page.tsx` | Web (hiện giá trên nút), skill `ads-chat` | Trước khi gen |
| Khung budget / tROAS | Target ROAS D0 = 100%; tiêu hết budget = ≥90%; scale khi ≥120% target; siết khi <80%; cắt khi <50%; mỗi lần chỉnh tối đa 20%; đủ dữ liệu khi cost ≥ max($5, 10% budget) hoặc ≥30 conversion; đang learning thì không chỉnh | `RULES` trong `lib/campDoctor.ts` (target D0 chỉnh được trên trang cho từng lần phân tích) | Phân tích Camp | Mỗi lần phân tích report |
| Cắt đoạn hướng dẫn quay điện thoại | Đoạn chạm cuối video: tự cắt; đoạn giữa: để người tick; gần như cả video giống màn hình điện thoại: không tự cắt | `public/outro-studio/index.html` | Outro Studio | Khi quét video |

## Tầng 4. Bài học đã duyệt

Nằm ở tab `BaiHoc` của sheet hệ thống, quản lý trên trang **🧠 Bài học**. Bài học có trạng thái *Áp dụng* được thêm vào
prompt của bước ghi ở cột "Áp dụng cho" (`anh`, `brief`, `chu`, `adcopy`), tối đa 8 bài mỗi bước, có hiệu lực trong vòng
5 phút. Cách AI đề xuất và người duyệt: [quy-trinh.md](quy-trinh.md) mục 5. Code: `lib/learning.ts`.

## Thêm, sửa, xoá, chuyển tầng một quy tắc

| Việc | Làm thế nào |
|---|---|
| Thêm / sửa / bỏ một bài học (tầng 4) | Trang 🧠 Bài học: sửa câu chữ, Áp dụng, Ngừng áp dụng. Không cần deploy |
| Sửa quy tắc tầng 1–3 | Sửa đúng **nguồn duy nhất** ghi ở bảng trên, cập nhật các chỗ nhắc lại ở mục "Chỗ nhắc lại" bên dưới, ghi một dòng vào "Lịch sử đổi quy tắc", tăng version, deploy |
| Đưa bài học lên tầng 3 | Bài học đã áp dụng ổn định (số lần sửa trên 100 ảnh giảm và giữ) thì viết hẳn vào prompt / code của tầng 3, rồi chuyển bài học sang *Bỏ*, ghi chú "đã đưa vào code vX" |
| Hạ một quy tắc tầng 3 xuống tầng 4 | Khi muốn thử nghiệm mà không deploy: bỏ khỏi code, tạo bài học tương ứng trên trang Bài học |
| Xoá một quy tắc | Xoá ở nguồn duy nhất và mọi chỗ nhắc lại; ghi lý do vào lịch sử |

## Chỗ nhắc lại (phải sửa theo khi đổi nguồn)

Những quy tắc dưới đây được **nhắc lại** trong tài liệu cho người hoặc cho Claude đọc. Code luôn theo nguồn duy nhất;
tài liệu thì phải sửa tay.

| Quy tắc | Nguồn | Được nhắc lại ở |
|---|---|---|
| Đặt tên Google++, số Gen | `lib/adTemplates.ts` | `skills/google-ads-studio/SKILL.md`, `skills/adtemp/SKILL.md`, `.claude/skills/ads-chat/SKILL.md`, `GUIDE` trong `app/api/mcp/[key]/route.ts` |
| Giá ảnh | `AB_COST_PER_IMAGE` trong `app/page.tsx` | `skills/google-ads-studio/SKILL.md`, `.claude/skills/ads-chat/SKILL.md` |
| Giới hạn chữ trên banner | `BRIEF_SCHEMA` trong `app/api/banner-concept/route.ts` | `LIMITS` trong `app/api/banner-localize/route.ts`, `.claude/skills/ads-chat/SKILL.md` |
| Khung budget / tROAS | `RULES` trong `lib/campDoctor.ts` | `skills/google-ads-studio/references/camp-analysis.md`, `skills/google-ads-studio/SKILL.md` |

## Mâu thuẫn đang chờ quyết

| Phát hiện | Hai quy tắc | Ảnh hưởng | Cần ai quyết |
|---|---|---|---|
| 2026-11-18, khi lập sổ này | Góc **social** trong `ANGLES` (`lib/adFormats.ts`) yêu cầu "two or three friendly characters together", trong khi prompt ảnh (`app/api/banner-generate/route.ts`) cấm tuyệt đối nhân vật thứ hai | Ảnh của slot góc social nhận hai lệnh trái nhau: hoặc ra một nhân vật (bỏ ý social proof), hoặc ra nhiều nhân vật (vi phạm luật một nhân vật, dễ bị sửa) | Trưởng nhóm UA: giữ "một nhân vật" và viết lại góc social (ví dụ: bình luận, số sao, lượt tải quanh nhân vật), hoặc cho phép riêng góc này nhiều người |

## Lịch sử đổi quy tắc

Mỗi lần đổi quy tắc tầng 1–3, thêm một dòng ở đầu bảng. Bài học tầng 4 có lịch sử riêng trong tab `BaiHoc` (ngày đề
xuất, người duyệt, ngày duyệt). Các dòng trước 18/11/2026 được dựng lại từ git log và CHANGELOG.

| Ngày | Tầng | Quy tắc | Đổi gì | Vì sao | Version / commit |
|---|---|---|---|---|---|
| 2026-11-18 | 3 | Học từ lần sửa | Lỗi lặp lại thành bài học, người duyệt mới vào prompt | Bớt lặp lỗi đã sửa nhiều lần | v8.0 |
| 2026-11-18 | 3 | Quyền | Role `creative` không dùng Launch Camp, Phân tích Camp, không duyệt bài học | Tách việc tiêu tiền / xem doanh thu khỏi việc làm creative | v7.2 |
| 2026-11-13 | 3 | Cắt đoạn hướng dẫn quay điện thoại | Đoạn cuối tự cắt, đoạn giữa để người tick | Đoạn đó là giao diện TikTok/CapCut, khác app mình | v6.4 |
| 2026-11-03 | 2 | Tag creative | Một tag main `<ngày> Gen<n>` + một tag thị trường | MKT System ghép creative với template theo tag | v5.2, `6f233ee` |
| 2026-11-03 | 2 | Tên ad template | `Ad Template <ngày> Gen<n> <thị trường>`; trùng tên thì cập nhật | Google++ tự ghép, bỏ bước map tay; tránh lỗi "Ambiguous" | v5.2, `b964335` |
| 2026-10-23 | 3 | Thị trường | Chọn thị trường thay vì chọn ngôn ngữ; thêm thị trường và ngôn ngữ bản địa | Mỗi thị trường dùng đúng ngôn ngữ của nó | v5.1, `ff1023f` |
| 2026-10-18 | 3 | Khung budget / tROAS | Target ROAS D0 = 100%, bảng mức tăng budget | Quyết định budget theo một khung chung | v5.0, `f5a4860` |
| 2026-10-16 | 3 | Tăng budget | Không gợi ý tăng budget khi camp chưa tiêu hết budget | Tăng budget không có tác dụng khi chưa tiêu hết | v5.0, `34c3c74` |
| 2026-10-15 | 3 | Localize | Không trộn ngôn ngữ, viết chữ bản địa, dòng sai thì dịch lại | Bản localize ra Taglish, Hinglish | v4.1, `a1bb7e2` |
| 2026-10-05 | 2 | Tên ad template | `Ad_Template_20261005_Gen1_US` (sau thay bằng quy ước v5.2) | Đặt tên theo ngày, Gen, thị trường | v4.0, `6884522` |
| 2026-10-01 | 3 | Viết ad copy | Bỏ CTA | App campaign không dùng CTA | v4.0, `607665c` |
| 2026-09-29 | 3 | Bố cục ảnh | Một nhân vật, không người đứng cạnh mascot | Ảnh ra hai nhân vật | v3.0, `b84d2a2` |
| 2026-09-29 | 3 | Thứ tự thao tác | Chọn thị trường trước creative direction | Chữ banner ra sai ngôn ngữ | v3.0, `d25d16e` |
| 2026-09-22 | 3 | Ngôn ngữ ad copy | Kiểm tra ad copy đúng ngôn ngữ của campaign | Chỉ kiểm tra "không phải tiếng Việt" là chưa đủ | v3.0, `49be783` |
