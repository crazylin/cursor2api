# cursor2api — 项目文档

> 版本: **v2.6.1** | 路径: `/Users/joyasushi/Desktop/cursor2apigithub`

---

## 概述

`cursor2api` 是一个本地代理服务，将 Cursor 文档页的免费 AI 接口转换为标准的
**Anthropic Messages API** 和 **OpenAI Chat Completions API**，使 Claude Code、
Cursor IDE、ChatBox、LobeChat 等工具可免费调用 Claude 模型。

---

## 技术栈

| 项目 | 内容 |
|------|------|
| 运行时 | Node.js + TypeScript (ESM, `"type": "module"`) |
| HTTP 框架 | Express v5 |
| 主要依赖 | `eventsource-parser`, `tesseract.js`, `undici`, `yaml`, `dotenv`, `uuid` |
| 入口文件 | `src/index.ts` → 编译输出 `dist/index.js` |
| 构建命令 | `npm run build` (tsc) |
| 开发命令 | `tsx watch src/index.ts` |
| 测试命令 | `npm run test:all` |

---

## 项目结构

```
cursor2apigithub/
├── src/
│   ├── index.ts            # 入口 + Express 服务 + 路由注册
│   ├── config.ts           # 配置管理 (YAML + 环境变量合并)
│   ├── types.ts            # Anthropic 协议类型定义
│   ├── openai-types.ts     # OpenAI 协议类型定义
│   ├── cursor-client.ts    # Cursor API 客户端 + Chrome TLS 指纹 + 空闲超时
│   ├── converter.ts        # 协议转换 + 提示词注入 + 上下文清洗 + Schema压缩
│   ├── handler.ts          # Anthropic 请求处理器 + 身份保护 + 拒绝拦截
│   ├── openai-handler.ts   # OpenAI / Cursor IDE 兼容处理器
│   ├── thinking.ts         # Thinking 模式处理
│   ├── tool-fixer.ts       # 工具参数容错 + tolerant JSON 解析
│   └── proxy-agent.ts      # HTTP 代理支持 (undici.ProxyAgent)
├── test/
│   ├── unit-tolerant-parse.mjs
│   ├── unit-tool-fixer.mjs
│   ├── unit-openai-compat.mjs
│   ├── unit-proxy-agent.mjs
│   ├── e2e-chat.mjs
│   └── e2e-agentic.mjs
├── claudedocs/
│   └── PROJECT.md
├── config.yaml
├── Dockerfile
├── docker-compose.yml
├── deploy.sh
└── CHANGELOG.md
```

---

## API 端点

| 端点 | 协议 | 用途 |
|------|------|------|
| `POST /v1/messages` | Anthropic | Claude Code 主入口 |
| `POST /v1/chat/completions` | OpenAI | ChatBox / LobeChat 等 |
| `POST /v1/responses` | OpenAI Responses API | Cursor IDE Agent 模式 |
| `POST /v1/messages/count_tokens` | Anthropic | Token 计数 |
| `GET  /v1/models` | OpenAI | 模型列表 |
| `GET  /health` | — | 健康检查 |

---

## 配置参考

### config.yaml 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `port` | number | 监听端口，默认 `3010` |
| `timeout` | number | 空闲超时 (ms) |
| `proxy` | string | HTTP 代理地址 |
| `cursor_model` | string | 转发模型，默认 `anthropic/claude-sonnet-4.6` |
| `enable_thinking` | bool | 是否启用 Thinking 模式 |
| `fp` | string | Base64 编码的 TLS 指纹配置 |
| `vision` | object | Vision 相关配置 |

### 环境变量覆盖

```bash
PORT=3010
TIMEOUT=60000
PROXY=http://127.0.0.1:7890
CURSOR_MODEL=anthropic/claude-sonnet-4.6
ENABLE_THINKING=false
FP=<base64>
```

---

## 核心机制

### 1. Chrome TLS 指纹模拟

`cursor-client.ts` 模拟完整 Chrome 140 请求头（`sec-ch-ua`、`sec-fetch-*` 等），
向 `https://cursor.com/api/chat` 发送请求。采用**空闲超时**替代固定总时长超时，
防止长输出被误杀。请求失败时自动重试最多 2 次，间隔 2s。

### 2. 流式 SSE 解析

- 流式读取 Cursor 返回的 SSE 响应
- 每收到新数据重置空闲计时器
- 支持流式 (`stream: true`) 和非流式两种模式

### 3. 截断续写机制

- 自动检测响应截断（代码块 / XML 未闭合）
- 内部自动续写最多 **6 次** (`MAX_AUTO_CONTINUE = 6`)
- 续写时注入 user 引导消息 + 最后 300 字符上下文锚点
- `deduplicateContinuation()` 去重拼接点，防止内容重复

### 4. 渐进式历史压缩

防止上下文过长导致请求失败：

- 保留最近 **6 条**消息完整
- 压缩早期消息中超过 **2000 字符**的文本
- 工具描述截断至 **80 字符**
- 工具结果截断至 **15000 字符**

### 5. Schema 压缩 (`compactSchema`)

将完整 JSON Schema 压缩为紧凑类型签名：

- 90 个工具: ~135k chars → **~15k chars**
- 输出预算从 ~3k 提升到 **~8k+ chars**

### 6. 拒绝检测与拦截

- 截断响应 (`stop_reason=max_tokens`) 跳过拒绝检测
- 长响应 (≥500 chars) 仅检查前 300 字符
- 短响应 (<500 chars) 全文检测
- 工具模式下触发拒绝时返回 `"Let me proceed with the task."`

### 7. Vision 支持

| 模式 | 说明 |
|------|------|
| OCR | `tesseract.js` 本地识别 |
| API | 多个 OpenAI 兼容视觉 API provider 顺序尝试 |
| fallback_to_ocr | 默认 `true`，API 失败时降级到 OCR |

---

## 快速使用

```bash
# 构建并启动
npm run build && node dist/index.js

# 配置 Claude Code
export ANTHROPIC_BASE_URL=http://localhost:3010

# 配置 OpenAI 兼容客户端
export OPENAI_BASE_URL=http://localhost:3010/v1
export OPENAI_API_KEY=any-string
```

### Docker

```bash
docker compose up -d
```

---

## 版本历史

| 版本 | 主要变更 |
|------|----------|
| v2.6.1 | 工具调用截断修复 + Thinking 占比优化 |
| v2.5.6 | 渐进式历史压缩 + 续写去重 + JSON 解析加固 |
| v2.5.5 | 修复长响应误判为拒绝 |
| v2.5.4 | 内网代理支持 (undici.ProxyAgent) |
| v2.5.3 | Schema 压缩 + JSON-String-Aware 解析器 + 续写机制重写 |
| v2.5.2 | 截断无缝续写 + 工具参数容错 |
| v2.5.0 | OpenAI Responses API + 跨协议防御 |

---

## 开发注意事项

- 项目使用 **ESM 模块**，import 路径需带 `.js` 后缀
- 不要自行运行 `pnpm dev` / `npm run dev`
- 测试: `npm run test:all`
- 构建产物输出到 `dist/`
- 文档和分析报告放在 `claudedocs/` 目录
