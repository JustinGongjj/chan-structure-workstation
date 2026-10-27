#!/usr/bin/env bash
# 发布到 Hugging Face Space（Docker SDK）。
# 在能访问 huggingface.co 的机器上执行：
#   HF_TOKEN=hf_xxx HF_USER=yourname ./scripts/publish-hf.sh [space-name]
set -euo pipefail
cd "$(dirname "$0")/.."

: "${HF_TOKEN:?需要 HF_TOKEN（https://huggingface.co/settings/tokens，勾选 write）}"
: "${HF_USER:?需要 HF_USER（你的 HF 用户名）}"
SPACE="${1:-chan-structure-workstation}"
REPO_ID="${HF_USER}/${SPACE}"

echo "▸ 创建 Space ${REPO_ID}（Docker SDK, 端口 8931）"
curl -fsS -X POST "https://huggingface.co/api/repos/create" \
  -H "Authorization: Bearer ${HF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${SPACE}\",\"type\":\"space\",\"sdk\":\"docker\",\"private\":false}" >/dev/null || \
  echo "  （Space 已存在，继续上传）"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ 组装 Space 文件"
cp -r server web data package.json "$TMP"/
cp space/README.md "$TMP"/README.md
cp space/Dockerfile "$TMP"/Dockerfile

cd "$TMP"
git init -q
git checkout -q -b main
git config user.email "deploy@chan-station.local"
git config user.name "chan-station"
git add -A
git commit -q -m "deploy: Chan Structure Workstation Space"
git remote add space "https://${HF_USER}:${HF_TOKEN}@huggingface.co/spaces/${REPO_ID}"
git push -q space main --force
echo "  ✓ https://huggingface.co/spaces/${REPO_ID}"
