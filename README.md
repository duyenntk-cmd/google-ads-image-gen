# Google Ads Image Generator

Tạo ảnh Google Display Ads từ video quảng cáo app mobile (Photo / Tool / Office).

## Deploy lên Vercel

### Bước 1 — Push lên GitHub

```powershell
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/google-ads-image-gen.git
git push -u origin main
```

### Bước 2 — Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → Import repo
2. **Environment Variables** → thêm: `ANTHROPIC_API_KEY = sk-ant-...`
3. **Deploy**

## Chạy local

```powershell
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev
```
