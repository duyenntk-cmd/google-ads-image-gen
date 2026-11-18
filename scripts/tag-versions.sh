#!/usr/bin/env bash
# Gắn git tag cho các version trong CHANGELOG.md rồi push lên GitHub.
# Chạy trên máy có quyền push repo:   bash scripts/tag-versions.sh
# Chạy lại bao nhiêu lần cũng được: tag nào đã có thì bỏ qua.
#
# Bảng dưới đây cũng là bản ghi version → commit (commit cuối của version đó trên main).
# Từ v1.0 tới v5.2 được gắn lại sau theo ngày trong log commit, vì lúc đó chưa có quy ước version.
# Version mới: thêm một dòng sau khi PR đã merge vào main (commit đã squash trên main, không phải commit trên nhánh).
set -euo pipefail

git fetch --quiet origin main --tags

while read -r version commit title; do
  [ -z "$version" ] && continue
  if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
    echo "đã có  $version"
    continue
  fi
  git tag -a "$version" "$commit" -m "$version — $title"
  echo "gắn    $version → $(git log -1 --format='%h %ad %s' --date=short "$commit")"
done <<'VERSIONS'
v1.0 42b907f Gen Banner
v1.1 16f33c7 32 ngôn ngữ, slide giới thiệu
v2.0 ae7b7fb Bộ công cụ nhiều tool
v2.1 eb158c9 Đăng nhập và bảo mật
v3.0 cd3b773 AI Banner cho App campaign
v4.0 8ff308b Kết nối MKT System, một trang ba bước
v4.1 0e177d6 Chất lượng localize
v5.0 f5a4860 Phân tích Camp
v5.1 ff1023f Localize theo thị trường
v5.2 b0fd2d4 Đặt tên theo Google++
v5.3 a54232c Đo được việc dùng thật
v6.0 0c5f034 Outro Studio
v6.1 35f1708 Link thẳng tới bộ creative vừa đẩy
v6.2 0a0dab6 Lịch sử push lên MKT
v6.3 6389988 Outro Studio: hết giật và kéo dài khi dựng realtime
v6.4 1ee8cfb Outro Studio: tự cắt đoạn hướng dẫn quay điện thoại
v6.5 540dd40 Outro Studio: quét và push nhanh hơn
v7.0 4b899c0 Tạo ad template bằng chat với Claude
v7.1 8c92b45 Gen banner và đẩy MKT ngay trong chat Claude Code
VERSIONS

git push origin --tags
echo "Xong. Kiểm tra: git ls-remote --tags origin"
