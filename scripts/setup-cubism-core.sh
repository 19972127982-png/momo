#!/usr/bin/env bash
# scripts/setup-cubism-core.sh
# 准备 Live2D Cubism Core + Hiyori 模型本地资源
#
# 为什么不直接进 git：
#   1. Cubism Core 的二进制 / 压缩 JS 文件属于 Live2D 私有协议（虽然可免费分发用于运行时），
#      建议作品集放在用户本地下载，不要进开源仓库
#   2. Hiyori PRO 模型受 Live2D 免费素材协议约束（个人 / 小企业商用 OK，但不能直接重分发）
#
# 运行：pnpm setup:cubism

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/apps/desktop/public"
CUBISM_DIR="$PUBLIC_DIR/cubism"
LIVE2D_DIR="$PUBLIC_DIR/live2d"
HIYORI_SRC="$REPO_ROOT/hiyori_en/hiyori_pro/runtime"
HIYORI_DEST="$LIVE2D_DIR/hiyori"

CUBISM_URL="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
CUBISM_FILE="$CUBISM_DIR/live2dcubismcore.min.js"

blue()  { printf "\033[34m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

blue "==> 1/3  准备目录"
mkdir -p "$CUBISM_DIR" "$LIVE2D_DIR"

blue "==> 2/3  下载 Cubism Core for Web (Live2D 官方)"
if [[ -f "$CUBISM_FILE" ]] && [[ $(wc -c < "$CUBISM_FILE") -gt 10000 ]]; then
  green "    Cubism Core 已存在：$CUBISM_FILE ($(wc -c < "$CUBISM_FILE") bytes)，跳过下载"
else
  if command -v curl >/dev/null 2>&1; then
    curl -fSL "$CUBISM_URL" -o "$CUBISM_FILE"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$CUBISM_URL" -O "$CUBISM_FILE"
  else
    red "    curl / wget 都没有，无法自动下载"
    yellow "    请手动下载到：$CUBISM_FILE"
    yellow "    源：$CUBISM_URL"
    exit 1
  fi

  SIZE=$(wc -c < "$CUBISM_FILE")
  if [[ "$SIZE" -lt 10000 ]]; then
    red "    下载内容过小 ($SIZE bytes)，可能是 404 或 CDN 故障"
    rm -f "$CUBISM_FILE"
    exit 1
  fi
  green "    下载完成：$CUBISM_FILE ($SIZE bytes)"
fi

blue "==> 3/3  软链 Hiyori PRO 模型"
if [[ ! -d "$HIYORI_SRC" ]]; then
  red "    源目录不存在：$HIYORI_SRC"
  yellow "    请先把 Hiyori PRO 模型解压到 hiyori_en/hiyori_pro/runtime/"
  exit 1
fi

if [[ -L "$HIYORI_DEST" ]] || [[ -e "$HIYORI_DEST" ]]; then
  yellow "    $HIYORI_DEST 已存在，删除重建"
  rm -rf "$HIYORI_DEST"
fi

ln -s "$HIYORI_SRC" "$HIYORI_DEST"
green "    软链完成：$HIYORI_DEST -> $HIYORI_SRC"

echo
green "✅  Live2D 资源就位"
echo "    Cubism Core : /cubism/live2dcubismcore.min.js"
echo "    Hiyori 模型  : /live2d/hiyori/hiyori_pro_t11.model3.json"
