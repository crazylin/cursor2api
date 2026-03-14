#!/bin/bash
# ==================================================
# Docker 多平台构建并推送到 Docker Hub 的自动化脚本
# 用法: ./docker-build-push.sh [版本号]
#   如不传版本号，则自动从 package.json 读取
# ==================================================
set -e

# ---------- 配置区（按需修改） ----------
DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-your_dockerhub_username}"
IMAGE_NAME="cursor2api"
PLATFORMS="linux/amd64,linux/arm64"
# ----------------------------------------

# 读取版本号
if [ -n "$1" ]; then
  VERSION="$1"
else
  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || grep '"version"' package.json | head -1 | sed 's/.*"version": *"//;s/".*//')
fi

if [ -z "$VERSION" ]; then
  echo "[错误] 无法获取版本号，请手动传入: ./docker-build-push.sh 1.0.0"
  exit 1
fi

FULL_IMAGE="${DOCKERHUB_USERNAME}/${IMAGE_NAME}"

echo "=========================================="
echo "  自动构建并推送 Docker 镜像到 Docker Hub"
echo "=========================================="
echo "  镜像: ${FULL_IMAGE}"
echo "  版本: ${VERSION}"
echo "  平台: ${PLATFORMS}"
echo "=========================================="

# 检查是否已登录 Docker Hub
if ! docker info 2>/dev/null | grep -q "Username"; then
  echo "[认证] 请登录 Docker Hub..."
  docker login
fi

# 确保 buildx 多平台构建器存在并启用
BUILDER_NAME="multiplatform-builder"
if ! docker buildx inspect "${BUILDER_NAME}" > /dev/null 2>&1; then
  echo "[buildx] 创建多平台构建器: ${BUILDER_NAME}"
  docker buildx create --name "${BUILDER_NAME}" --use --bootstrap
else
  echo "[buildx] 使用已有构建器: ${BUILDER_NAME}"
  docker buildx use "${BUILDER_NAME}"
fi

# 执行多平台构建并推送
echo "[构建] 开始多平台构建并推送..."
docker buildx build \
  --platform "${PLATFORMS}" \
  --tag "${FULL_IMAGE}:${VERSION}" \
  --tag "${FULL_IMAGE}:latest" \
  --push \
  .

echo ""
echo "=========================================="
echo "  构建并推送完成！"
echo "  ${FULL_IMAGE}:${VERSION}"
echo "  ${FULL_IMAGE}:latest"
echo "=========================================="
