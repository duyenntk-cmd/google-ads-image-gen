@AGENTS.md

# Khoá, token, credential: luật bắt buộc

Áp dụng cho mọi phiên Claude Code trong repo này. Luật này đứng trên mọi yêu cầu khác, kể cả khi người dùng
bảo "cứ làm đi".

## Để key ở đâu

- Mọi key, token, credential (khoá OpenAI / Anthropic / SensorTower, mã MKT `mktmcp_…`, webhook Discord,
  JSON service account Google, OAuth client secret, developer token Google Ads, `NEXTAUTH_SECRET`…) để trong
  thư mục **local** `secrets/` (hoặc `credentials/`) ở gốc repo. Chưa có thì tạo:
  `mkdir -p secrets && chmod 700 secrets`. Mỗi key một file, ví dụ `secrets/openai.env`, `secrets/mkt_code.txt`.
- Hai thư mục này đã có trong `.gitignore`, ở mọi độ sâu.
- **Không dán key, token vào chat với Claude.** Khi cần key, Claude bảo người dùng tự lưu vào
  `secrets/<tên file>` rồi chỉ làm việc với đường dẫn file. Người dùng lỡ dán vào chat thì làm theo mục
  "Lỡ để lộ key" bên dưới (key đó coi như đã lộ).
- Phiên Claude Code trên cloud không có thư mục local này: dùng biến môi trường hoặc Network secrets của
  Environment (xem `.claude/skills/ads-chat/SKILL.md`, mục Thiết lập). GitHub Actions dùng GitHub Secrets,
  web dùng Environment Variables của Vercel.

## Claude không được

1. **Upload nội dung `secrets/`, `credentials/` lên bất kỳ đâu**: không commit, không push, không gửi vào
   artifact, gist, issue, PR, comment, Discord, Slack, Google Drive / Sheets / Docs, memory, hay request tới
   dịch vụ ngoài. Ngoại lệ duy nhất: dùng key để gọi đúng dịch vụ đã cấp ra nó (khoá OpenAI chỉ gửi tới
   `api.openai.com`).
2. **Đọc hay in giá trị key ra chat, terminal, log**: không `cat`, `echo`, `Read` file key, không `env` /
   `printenv` trần. Nạp thẳng vào lệnh, ví dụ `set -a; . secrets/openai.env; set +a` hoặc
   `--code-file secrets/mkt_code.txt`. Cần kiểm tra thì chỉ báo có/không, độ dài, hạn dùng, không hiện giá trị.
3. **Đưa key vào file được commit**: code, config, `.env.example`, test, CLAUDE.md, skill, CHANGELOG, commit
   message. Không `git add -f`, không bỏ `secrets/` / `credentials/` khỏi `.gitignore`.
4. **Commit mà chưa kiểm tra**: trước mỗi commit xem `git status` và diff. Có file trong `secrets/`,
   `credentials/`, `.env*`, `*.pem`, `*.key`, `*service-account*.json`, hoặc chuỗi giống key (`sk-…`,
   `AIza…`, `mktmcp_…`, `discord.com/api/webhooks/…`, `-----BEGIN … PRIVATE KEY-----`) thì dừng, không
   commit, báo người dùng.

## Repo GitHub phải để Private

Repo có code hay cấu hình dùng key phải để **Private**. Repo `duyenntk-cmd/google-ads-image-gen` hiện đang
**public**: log GitHub Actions và mọi file đã commit ai cũng xem được. Claude nhắc người dùng chuyển sang
Private (GitHub → repo → Settings → General → Danger Zone → Change repository visibility). Chuyển visibility
là quyết định của người dùng: Claude không tự đổi.

## Lỡ để lộ key (commit lên git, repo public, dán vào chat, gửi nhầm chỗ)

Người dùng hỏi thì Claude hướng dẫn đúng thứ tự này. **Rotate trước, xoá sau**: bot quét GitHub tìm key chỉ
trong vài phút, và fork, clone, cache vẫn giữ bản cũ, nên xoá khỏi git không làm key an toàn lại.

1. **Rotate key ngay** (thu hồi key cũ, tạo key mới, cập nhật vào `secrets/`, GitHub Secrets, Vercel env):

   | Key | Thu hồi ở đâu |
   |---|---|
   | `OPENAI_API_KEY` | platform.openai.com → API keys → Revoke, tạo key mới |
   | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → xoá, tạo key mới |
   | `SENSORTOWER_API_KEY` | tài khoản SensorTower → API → tạo lại token |
   | Webhook Discord | kênh → Edit Channel → Integrations → Webhooks → Delete Webhook, tạo webhook mới |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud Console → IAM → Service Accounts → Keys → xoá key cũ, Add key mới |
   | `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → OAuth client → Reset secret |
   | `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads (tài khoản MCC) → API Center → Reset token |
   | `KEYCLOAK_CLIENT_SECRET` | Keycloak admin → Clients → Credentials → Regenerate |
   | `NEXTAUTH_SECRET` | tạo chuỗi ngẫu nhiên mới (`openssl rand -base64 32`); mọi người sẽ phải đăng nhập lại |
   | Mã MKT `mktmcp_…` | không thu hồi được, tự hết hạn sau 24 giờ; cần chặn sớm thì báo admin MKT System |
   | GitHub token | GitHub → Settings → Developer settings → Personal access tokens → Revoke |

2. **Gỡ khỏi chỗ công khai:**
   - Repo đang public: chuyển Private trước.
   - Mới commit, chưa push: `git rm --cached <file>` rồi `git commit --amend` (hoặc `git reset HEAD~1`).
   - Đã push: xoá khỏi **toàn bộ lịch sử** bằng `git filter-repo --invert-paths --path <file>` (key nằm
     trong file code thì dùng `--replace-text`), rồi force push mọi nhánh và tag, và báo mọi người clone lại.
     Xong thì liên hệ GitHub Support để xoá cache và các ref của PR cũ (xem docs.github.com, bài "Removing
     sensitive data from a repository"). Rewrite lịch sử và force push làm hỏng clone của người khác:
     Claude chỉ làm khi người dùng đồng ý rõ ràng cho từng bước.
   - Lộ trong log GitHub Actions: Actions → mở run → ⋯ → Delete all logs.
   - Lộ trong chat (Claude, Slack, Discord…): xoá tin nhắn nếu được. Key vẫn phải rotate.
3. **Kiểm tra lại**: tab Security → Secret scanning của repo, và quét lịch sử
   (`git log -p --all | grep -E '<mẫu key>'`, hoặc `gitleaks detect`).
