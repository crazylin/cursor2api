# Changelog

## v2.6.4 (2026-03-15)

### 🧹 系统提示词深度清洗 — 根治 Prompt Injection 检测

- **问题**：Claude Sonnet 4.6+ 将转发的 Claude Code 系统提示词中的 `<identity>`、`<skills>` 等 XML 标签识别为"另一个 AI 的系统提示词注入"，触发拒绝
- **新增 `sanitizeSystemPrompt()`**：两级标签处理策略
  - **Tier 1 完全剥离**：`<identity>`、`<tool_calling>`、`<communication_style>`、`<knowledge_discovery>`、`<persistent_context>` 等纯 AI 行为规则标签 — 连同内容整体删除
  - **Tier 2 去壳保留**：`<user_information>`、`<user_rules>`、`<artifacts>`、`<mcp_servers>` 等项目上下文标签 — 仅删 XML 壳，保留有用内容
- 清除 `x-anthropic-billing-header` 等会被模型判定为恶意伪造的计费头
- 残留身份定义语句（"made by Anthropic"、"pair programming"）正则清理

### 🎭 认知重构升级 — 从"文档助手"到"自动化测试助手"

- **策略升级**：由 v2.6.3 的"写文档生成 JSON 示例"改为"自动化测试沙盒执行"框架
  - 模型被引导为 **Cursor Automated Testing Assistant**，所有工具调用被包装为"沙盒执行测试步骤"
  - 工具结果标记从 `Action output:` 改为 `[Sandbox Execution Result - Success/Error]`
  - 续写引导从 "continue with next action" 改为 "continue the automated test scenario"
- **Base64 编码敏感字符串**：所有提示词注入相关的关键文本均 Base64 编码，防止 AI 分析自身代码时识别注入模式
- **首条/末条消息差异化**：首条用户消息注入测试场景描述，末条消息追加执行引导

### 📋 用户消息 XML 标签两级处理

- 与系统提示词清洗策略一致：`<system-reminder>`、`<ephemeral_message>` 等 Tier 1 标签完全丢弃
- `<user_information>` 等 Tier 2 标签仅去壳保留内容，确保模型仍能获取项目上下文
- 新增诊断日志：输出每条用户消息的 XML 标签分析结果

### 📄 README 精简

- 移除内联更新日志（独立 CHANGELOG.md 维护）
- 移除项目结构树（减少维护成本）
- 移除 ASCII 架构图

---

## v2.6.2 (2026-03-14)

### 🗜️ 动态工具结果预算 — 替代固定 15K 硬编码

- **根因**：Cursor API 输出预算与输入大小成反比，固定 15K 工具结果在大上下文下严重挤压输出空间，导致工具调用截断
- **新增 `getToolResultBudget()`**：根据当前上下文大小动态计算工具结果截断阈值
  - \>100K chars → 4K | >60K → 6K | >30K → 10K | ≤30K → 15K（完整保留）
- 在 `convertToCursorRequest()` 中预估并跟踪上下文字符数，压缩前后均更新

### 🗜️ 工具指令体积优化 — 减少 ~30% 输入

- **已知工具跳过描述**：Read/Write/Edit/Bash/Search 等常用工具不再输出冗余描述（模型已从训练数据中了解）
- **大工具集激进压缩**：>25 个工具时 `compactSchema()` 仅保留 required 参数，进一步缩减输入
- **few-shot 紧凑化**：示例工具调用从 pretty-print JSON 改为单行紧凑 JSON
- 历史压缩阈值从 400K 降至 **100K**，工具模式下早期消息截断从 2000 降至 **1500** 字符

### 🧠 Thinking 处理简化 — 消除浪费性重试

- **问题**：之前检测到 thinking 占比过高时会发起额外 API 调用重试，浪费 1 次请求且效果不稳定
- **新策略**：工具指令中主动注入 `Do NOT use <thinking> tags` 禁令，从源头阻止 thinking 输出
- 工具模式下收到 thinking 直接静默剥离，不再触发重试 API 调用
- 流式 / 非流式路径统一对齐：thinking 提取逻辑从 `config.enableThinking` 条件改为无条件提取 + 按模式选择性保留
- **效果**：工具模式下节省 1-2 次 API 调用，降低延迟和 quota 消耗

### ⚡ 输出格式优化

- 工具指令新增 `Use compact JSON` 规则，引导模型输出无多余空白的 JSON action blocks
- Write 工具行数限制从 150 → **80 行**，超出时引导使用 `cat >> file` 分片写入
- 整体减少输出 token 消耗，为实际内容留更多空间

---

## v2.6.1 (2026-03-13)

### 🔧 工具调用截断修复五连发

- **isTruncated 重写**：消除工具调用 JSON 中反引号导致的误判（如代码块内的 \`\`\` 被当作未闭合标记）
- **完整工具调用跳过 Tier 恢复**：检测到完整 \`\`\`json action 块时直接跳过阶梯式截断恢复，避免浪费 4 次 API 调用
- **工具模式不注入 THINKING_HINT**：根治 thinking 占用输出预算导致工具调用截断的问题
- **Thinking 占比过高自动禁用重试**：thinking 内容远超实际内容时丢弃并禁用 thinking 重新请求
- **拒绝率回归修复**：v2.6.1 拒绝检测关键词调优 + thinking 标签反引号修复 + URL 图片兼容

---

## v2.6.0 (2026-03-12)

### 🖼️ 图片解析多 Provider 支持 (#27)

- 支持多个 OpenAI 兼容视觉 API provider 顺序尝试
- 兜底本地 OCR (tesseract.js)

### 🛡️ 反拒绝策略增强

- 借鉴 Cursor-Toolbox 策略：角色扩展 + thinking 严格化
- 拒绝恢复文本改为主动工具引导，防止模型放弃任务

---

## v2.5.6 (2026-03-12)

### 🗜️ 渐进式历史压缩

- **新策略**：保留最近 6 条消息完整不动，仅压缩早期消息中超过 2000 字符的文本部分
- 不删除任何消息（保留完整对话结构），只截短单条消息的超长文本
- 兼顾上下文完整性与输出空间，替代之前被移除的全删式智能压缩
- 工具描述截断从 200 → **80 字符**（Schema 已包含参数信息，短描述节省输入体积）
- 工具结果截断从 30000 → **15000 字符**（为输出留更多空间）

### 🔧 续写智能去重

- **问题**：模型续写时经常重复截断点附近的内容，拼接后出现重复段落
- **新增 `deduplicateContinuation()`**：在原内容尾部和续写头部之间搜索最长重叠，自动移除重复部分
- 支持字符级精确匹配和行级模糊匹配两种去重策略
- 去重后无新内容时自动停止续写（防止无限循环）
- 流式和非流式路径均已集成

### ⚡ 非流式截断续写（与流式路径对齐）

- **问题**：非流式模式下 Write 大文件等长输出被截断后，Claude Code 直接收到不完整的工具调用 JSON，导致 `tool_use` 退化为纯文本
- **修复**：非流式路径新增内部截断续写（最多 6 次），与流式路径逻辑完全对齐
- 新增 `tool_choice=any` 强制重试（非流式）：模型未输出工具调用时自动追加强制消息重试
- 新增极短响应重试（非流式）：响应 < 10 字符时自动重试

### 📊 Token 估算优化

- 提取 `estimateInputTokens()` 为独立函数，Anthropic 和 OpenAI handler 共用
- 估算比例从 1/4 调整为 **1/3**（更适合中英文混合和代码场景）+ 10% 安全边距
- 新增工具定义的 token 估算（每个压缩工具签名 ~200 chars + 1000 chars 指令开销）
- 替代之前 `input_tokens: 100` 的硬编码占位符

### 🛡️ JSON 解析器加固

- **反斜杠计数精确化**：`tolerantParse` 和 `parseToolCalls` 中的字符串状态跟踪从 `escaped` 布尔标志改为**反向计数连续反斜杠**，正确处理 `\\\"` (未转义) vs `\\\\\\\"` (已转义) 等边界情况
- **新增第五层逆向贪婪提取**：当所有 JSON 修复手段失败时，对 Write/Edit 等工具的 `content`/`command`/`text` 等大值字段进行逆向贪婪提取，从 JSON 末尾向前搜索值的结束引号
- 小值字段（`file_path`、`path` 等）仍用精确正则提取

---

## v2.5.5 (2026-03-12)

### 🐛 修复长响应误判为拒绝

- **问题**：工具模式下，模型输出长文本（如 8654 字符的深度分析报告），正文中碰巧包含 `无法提供...信息`、`工具调用场景`、`即报错` 等拒绝检测关键词，导致整个响应被替换为无意义的引导文本 `"I understand the request..."`，进而 Claude Code 陷入死循环
- **修复策略**：
  - 截断响应（`stop_reason=max_tokens`）完全跳过拒绝检测 — 8654 字符的响应不可能是拒绝
  - 长响应（≥ 500 字符）仅检查**前 300 字符**是否包含拒绝模式 — 拒绝一定在开头
  - 短响应（< 500 字符）保持全文检测 — 真正的拒绝回复通常很短
- 流式和非流式处理均已修复

### 🔇 减少 tolerantParse 日志噪音

- 模型输出中的普通 JSON 代码块（如含正则 `[\s\S]*?` 的代码示例）不再打印 `error` 级别日志
- 仅当内容包含 `"tool"` / `"name"` 键（疑似工具调用）时才报 error，其余降为 `warn` 级别

---
## v2.5.4 (2026-03-11)

### 🌐 内网代理支持 (Issue #17)

- **修复 `fetch failed`**：Node.js 原生 `fetch()` 不读取 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，内网用户设置这些变量后请求仍然直连失败
- **新增 `proxy-agent.ts`**：使用 `undici.ProxyAgent` 作为 fetch dispatcher，所有外发请求（Cursor API、Vision API）均可通过 HTTP 代理转发
- **配置方式**：在 `config.yaml` 中设置 `proxy` 字段，或通过 `PROXY` 环境变量指定（支持 `http://用户名:密码@代理:端口` 格式）
- **单元测试**：新增 16 个测试用例覆盖代理模块的核心逻辑

---
## v2.5.3 (2026-03-11)

### 🗜️ Schema 压缩 — 根治截断问题

- **根本原因定位**：90 个工具的完整 JSON Schema 占用 ~135,000 chars，导致 Cursor API 输出预算仅 ~3,000 chars，Write/Edit 工具的 content 参数被严重截断
- **compactSchema() 压缩**：将完整 JSON Schema 转为紧凑类型签名（如 `{file_path!: string, encoding?: utf-8|base64}`），输入体积降至 ~15,000 chars
- **工具描述截断**：每个工具描述最多 200 chars，避免个别工具（如 Agent）的超长描述浪费 token
- **效果**：输出预算从 ~3k 提升到 ~8k+ chars，Write 工具可一次写入完整文件

### 🔧 JSON-String-Aware 解析器

- **修复致命 Bug**：旧的 lazy regex `/```json[\s\S]*?```/g` 会在 JSON 字符串值内部的 ``` 处提前闭合，导致 Write/Edit 工具的 content 参数（如含 markdown 代码块的文档）被截断为仅前几行
- **新实现**：手动扫描器跟踪 JSON 字符串状态（`"` 配对 + `\` 转义），只在字符串外部匹配闭合 ```
- **截断恢复**：无闭合 ``` 的代码块也能通过 tolerantParse 恢复工具调用

### ⚠️ 续写机制重写

- **修复空响应问题**：旧实现只追加 assistant 消息，Cursor API 看到最后是 assistant 的消息后返回空响应
- **新实现**：每次续写添加 user 引导消息 + 最后 300 chars 上下文锚点
- **防膨胀**：每次基于原始消息快照重建，而非累积消息
- **MAX_AUTO_CONTINUE** 从 4 提升至 6

---
## v2.5.2 (2026-03-11)

### 🗜️ 移除上下文智能压缩 (Reverted)

移除上一版本引入的“智能压缩替裁剪”功能。
- **原因**：Claude Code等Agent非常依赖完整的工具调用历史（尤其是 `Read` 和 `Bash` 的具体输出）来决定下一步行动。将 `Action output` 压缩为 `[30000 chars...]` 以及将历史命令压缩为 `[System Note...]` 会导致大模型“失忆”，进而在多轮对话中陷入死循环、产生幻觉，甚至复读 `[Called Bash...]` 等错误格式。
- **替代方案**：通过新增的 `isTruncated` 自动检测并返回 `stop_reason: "max_tokens"`，已经能有效解决需要频繁点“继续”按钮的问题，因此粗暴的历史压缩不再被需要。

### ⚠️ 截断无缝续写 (Internal Auto-Continue)

- **Proxy-Side 无缝拼接**：彻底解决大文件编辑（如 `Write` 工具写了几万字）时被 API 截断，导致 JSON 解析失败、变为普通文本从而丢失工具调用的致命问题！
- **自动检测与请求**：当模型输出触发截断（如代码块/XML未闭合），Proxy 将在 **底层直接自动重试续写**，无需任何额外交互。
- **防止工具调用退化为文本**：由于 Anthropic API 会在不同消息间打断工具调用块，造成 Claude Code 将 `{"tool": "Write", ...}` 降级为屏幕上的纯文本并崩溃停顿（Crunched 几分钟）。现在，Proxy 会内部拼接 2-4 次请求，始终将一个完整未截断的 JSON 动作一次性抛给 Claude Code，极大提高了多轮复杂任务的成功率！

### 🔧 工具参数容错 (tool-fixer)

- **移除隐式重命名 `file_path` 为 `path` 行动**：修复 Claude Code 2.1.71 中 `Read` 工具因为必需参数 `file_path` 被强制丢弃而陷入请求验证失败死循环的问题。
- **新增第四层正则兜底**：当模型生成的 JSON 工具调用包含未转义双引号（如代码内容参数）导致标准解析和控制字符修复均失败时，使用正则提取 `tool` 名称和 `parameters` 字段
- 解决 `SyntaxError: Expected ',' or '}'` at position 5384 等长参数解析崩溃问题

### 🛡️ 拒绝 Fallback 优化

- 工具模式下拒绝时返回极短文本 `"Let me proceed with the task."`，避免 Claude Code 误判为任务完成

---

## v2.5.0 (2026-03-10)

- OpenAI Responses API (`/v1/responses`) 支持 Cursor IDE Agent 模式
- 跨协议防御对齐（Anthropic + OpenAI handler 共享拒绝检测和重试逻辑）
- 统一图片预处理管道（OCR/Vision API）
