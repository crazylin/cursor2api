# Cursor2API Desktop

Cursor2API 的 Electron 桌面版，提供系统托盘管理界面，无需命令行即可使用。

## 开发运行

```bash
# 1. 先构建主服务
cd ..
npm install
npm run build

# 2. 安装桌面版依赖
cd desktop
npm install

# 3. 开发模式启动
npm run dev
```

## 打包发布

```bash
cd desktop
npm run build:win    # Windows .exe 安装包
npm run build:mac    # macOS .dmg
npm run build:linux  # Linux .AppImage
```

打包产物在 `desktop/dist/` 目录。

## 功能

- **系统托盘**：右键菜单快速启动/停止/重启服务
- **控制台**：服务状态、运行时长、API 端点一键复制
- **日志**：实时查看服务输出日志
- **配置**：图形化编辑 config.yaml，无需手动找文件
- **关闭到托盘**：关闭窗口不退出，服务持续运行
