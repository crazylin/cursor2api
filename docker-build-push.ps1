# ==================================================
# Docker 多平台构建并推送到 Docker Hub 的自动化脚本 (PowerShell)
# 用法: .\docker-build-push.ps1 [-Version 版本号] [-Username 用户名]
# ==================================================
param(
    [string]$Version = "",
    [string]$Username = $env:DOCKERHUB_USERNAME
)

$ErrorActionPreference = "Stop"

# ---------- 配置区（按需修改） ----------
if (-not $Username) { $Username = "your_dockerhub_username" }
$ImageName = "cursor2api"
$Platforms = "linux/amd64,linux/arm64"
# ----------------------------------------

# 读取版本号
if (-not $Version) {
    $pkgJson = Get-Content "package.json" -Raw | ConvertFrom-Json
    $Version = $pkgJson.version
}

if (-not $Version) {
    Write-Error "[错误] 无法获取版本号，请手动传入: .\docker-build-push.ps1 -Version 1.0.0"
    exit 1
}

$FullImage = "${Username}/${ImageName}"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  自动构建并推送 Docker 镜像到 Docker Hub" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  镜像: ${FullImage}"
Write-Host "  版本: ${Version}"
Write-Host "  平台: ${Platforms}"
Write-Host "==========================================" -ForegroundColor Cyan

# 检查 Docker 是否运行
try {
    docker info | Out-Null
} catch {
    Write-Error "[错误] Docker 未启动，请先启动 Docker Desktop"
    exit 1
}

# 登录 Docker Hub
Write-Host "[认证] 登录 Docker Hub (用户名: ${Username})..."
docker login --username $Username
if ($LASTEXITCODE -ne 0) {
    Write-Error "[错误] Docker Hub 登录失败"
    exit 1
}

# 确保 buildx 多平台构建器存在并启用
$BuilderName = "multiplatform-builder"
$builderExists = docker buildx inspect $BuilderName 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[buildx] 创建多平台构建器: ${BuilderName}"
    docker buildx create --name $BuilderName --use --bootstrap
} else {
    Write-Host "[buildx] 使用已有构建器: ${BuilderName}"
    docker buildx use $BuilderName
}

# 执行多平台构建并推送
Write-Host "[构建] 开始多平台构建并推送..."
docker buildx build `
    --platform $Platforms `
    --tag "${FullImage}:${Version}" `
    --tag "${FullImage}:latest" `
    --push `
    .

if ($LASTEXITCODE -ne 0) {
    Write-Error "[错误] 构建或推送失败"
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  构建并推送完成！" -ForegroundColor Green
Write-Host "  ${FullImage}:${Version}" -ForegroundColor Green
Write-Host "  ${FullImage}:latest" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
