# W3 技术方案 · 单 CompanionAgent 陪伴闭环 + 工作 Agent 起骨架

> 状态：规划中 · 前置：W1 ✅ W2 ✅ · 周期：~7 天
>
> 目标：把 W2 的「单 LLM 调用 + W2 mock 性格」demo 升级为：
> - **单 CompanionAgent**（情绪 / 记忆 / 性格全转为 prompt 注入），完整陪伴闭环
> - **三层记忆**：工作记忆（SQLite）+ 情景记忆（ChromaDB + bge embedding）+ 用户画像（SQLite JSON）
> - **性格演化引擎**真实接入：异步 delta 漂移 + 双层 prompt 第二层动态拼接
> - **工作 Agent 起骨架**：MCP host + FileAgent 跑通一次 read-only end-to-end，留权限闸/审批 UX 给 W4
>
> 设计变更：陪伴族从原 v2.0 PRD 的「三 Agent 并行 + 路由融合」简化为「**1 个 CompanionAgent + 被动 RAG 注入**」，LLM 调用从 3-4 次/轮降到 1 次/轮 + 1 次异步性格分析。

---

## 1. W3 范围（In Scope）

### 主线：CompanionAgent 陪伴闭环

| 模块 | 功能 | 优先级 |
|---|---|---|
| **agent-core 包** | `Agent` / `Router` / `MemoryStore` / `PromptBuilder` 抽象接口（为 W3 副线 + W4 + V2 Web 端预埋） | P0 |
| **CompanionAgent** | 单 Agent，复用 W2 `streamDeepSeek`，prompt 内嵌情绪识别 + 共情风格切换 | P0 |
| **PromptBuilder** | 双层拼接：静态底色（小桃）+ 三维动态修饰（W3 D5 接真实性格状态） | P0 |
| **三层记忆 · 工作记忆** | `conversation_messages` 表每轮 append；最近 20 轮注入 prompt | P0 |
| **三层记忆 · 用户画像** | `user_profile` 表 + JSON 字段；触发式 + 5 轮兜底跑 LLM 抽取新事实 → upsert | P0 |
| **三层记忆 · 情景记忆** | ChromaDB sidecar + `bge-small-zh-v1.5` 本地 embedding + 摘要 Agent + Top-K 召回 | P0 |
| **性格演化引擎** | `pet_personality` + `evolution_log` 表；异步 LLM delta（60 token, temp=0.3, timeout=5s, swallow） | P0 |
| **双层 prompt 接入真实性格** | D5 完成后，第二层动态修饰按真实三维向量按 4 段映射拼接 | P0 |

### 副线：工作 Agent 起骨架

| 模块 | 功能 | 优先级 |
|---|---|---|
| **状态机扩展** | XState v5 新增 `acting` / `observing` / `awaiting-approval` sub-state（一次写完，W3 D6 + W4 都用） | P0 |
| **mcp-host 包** | `@modelcontextprotocol/sdk-node` 集成；stdio transport spawn 子进程 | P0 |
| **FileAgent (P0 only)** | 挂 `@modelcontextprotocol/server-filesystem`（白名单 `~/Desktop`） | P0 |
| **DeepSeek function calling bridge** | MCP `Tool` schema → DeepSeek `tools` 字段；`tool_result` 包装为 `role=tool` 消息回喂 | P0 |
| **两级路由器（一级）** | 「陪伴 vs 实用」二分类（关键词 + LLM zero-shot 兜底）；二级在 W3 暂仅识别 FileAgent | P0 |
| **read-only E2E demo** | 「列一下我的 Desktop 有什么」端到端跑通 | P0 |

### 收尾

| 模块 | 功能 |
|---|---|
| **E2E 自测** | 30 轮自然对话（验证性格 L2 漂移 ≥ 0.15 + 用户画像 upsert + 情景记忆召回）+ 1 次工作流 |
| **文档** | `W3-TECH-PLAN.md` 收尾 + README W3 一节 |
| **commit + 双仓推送** | 同 W2 流程 |

## 2. Out of Scope（W3 不做）

- ❌ MoodAgent / MemoryAgent 独立 Agent（合并到 CompanionAgent prompt 注入）
- ❌ 权限闸 + 审批 UX → **W4**
- ❌ `write` / `exec` / `network` scope 工具 → **W4**
- ❌ DevAgent (git MCP) / WebAgent (brave-search) → **W4**
- ❌ Skills 框架（4 个内置包） → **W4**
- ❌ 评测闭环 + LLM-as-Judge → **W5**
- ❌ Monitor 看板 / 状态可视化面板 → **W5**
- ❌ Agent 自动降权 → **W5**

---

## 3. 依赖增项

### 桌面端

```jsonc
// apps/desktop/package.json
{
  "dependencies": {
    "better-sqlite3": "^11",
    "chromadb": "^1.10",               // npm 是 HTTP client，需要 sidecar 跑 Python chromadb
    "onnxruntime-node": "^1.18",       // 跑 bge embedding 模型
    "@modelcontextprotocol/sdk": "^1"  // MCP host
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7"
  }
}
```

### 新增 workspace 包

```
packages/agent-core/                 # 跨端 agent + memory + prompt 抽象
  src/
    types.ts                         # Agent / Router / MemoryStore / PromptBuilder 接口
    companion-agent.ts               # 单 Agent 实现（注入 streamDeepSeek + PromptBuilder）
    prompt-builder.ts                # 双层拼接
    intent-router.ts                 # 两级路由（W3 仅一级）
    memory-store-sqlite.ts           # SQLite 实现
    memory-store-chroma.ts           # ChromaDB http client 实现
    embedding-bge.ts                 # bge-small-zh + onnxruntime
    index.ts
  test/
    *.test.ts

packages/mcp-host/                   # MCP host + transport + function calling bridge
  src/
    host.ts                          # 注册 / spawn / tools/list cache
    transport-stdio.ts
    transport-sse.ts                 # W4 加
    bridge.ts                        # MCP ↔ DeepSeek FC schema 翻译
    types.ts
    index.ts
  test/
    bridge.test.ts
```

### Python sidecar（仅 dev / first-run）

```
scripts/
  install-chromadb.sh                # 一键 pip install chromadb 到 .venv
  setup-bge-model.sh                 # 下载 bge-small-zh-v1.5 onnx 模型到 apps/desktop/public/models/
  run-chromadb.sh                    # 主进程 spawn 此脚本启 chromadb server
```

资产路径：

- ChromaDB 数据：`~/Library/Application Support/echopet-desktop/chroma/`（gitignored）
- bge 模型：`apps/desktop/public/models/bge-small-zh-v1.5/`（gitignored，setup 脚本下）

---

## 4. 文件清单

### 新增

```
packages/agent-core/                       # 上述 §3
packages/mcp-host/                         # 上述 §3

apps/desktop/src/main/
  db/
    migrations/
      001_init.sql                         # conversation_messages / user_profile / pet_personality / evolution_log
    schema.ts                              # 类型 + better-sqlite3 wrapper
    repo-messages.ts                       # CRUD
    repo-profile.ts
    repo-personality.ts
    repo-evolution.ts
  memory/
    workingMemory.ts                       # 最近 N 轮
    profileExtractor.ts                    # 触发式画像提取 LLM 调用
    episodicMemory.ts                      # ChromaDB client + 写入 + 召回
    summaryAgent.ts                        # 摘要 Agent（每 N 轮提炼事件卡片）
  personality/
    engine.ts                              # post-response 异步 delta + clamp + upsert
    growthStage.ts                         # 互动次数 → 阶段映射
    promptMapper.ts                        # 三维向量 → 4 段描述映射（按 PRD §4.7.2）
  mcp/
    bootstrap.ts                           # 启动时按配置 spawn MCP servers
    chromaSidecar.ts                       # spawn Python chromadb server + ready 检测
    bgeEmbed.ts                            # onnxruntime + tokenizer
  chat.ts                                  # 新版 chat handler：调 CompanionAgent + 异步性格分析
```

### 改动

```
apps/desktop/src/main/
  index.ts                                 # 启动时 init db + spawn chromadb + 加载 bge
  llm.ts                                   # 加 function calling 支持（tools / tool_choice 字段）
                                           # 流式解析加 tool_calls 处理

apps/desktop/src/renderer/src/App.tsx      # 状态机用扩展版 machine（含 acting/observing）

packages/state-machine/src/
  machine.ts                               # 扩展 thinking 内 sub-state；加 awaiting-approval（W4 用）
  types.ts                                 # 新增 PetEvent: tool.call-start / tool.call-end / tool.error
  index.ts
test/machine.test.ts                       # 新增 ~10 个测试用例覆盖新转移
```

---

## 5. 关键技术点

### 5.1 CompanionAgent 单 Agent prompt 设计

```ts
const SYSTEM_PROMPT_TEMPLATE = `
你是「{persona_name}」，一只住在用户桌面的小伙伴。

【你的人格底色 — 永远不变】
- 温暖、轻倾听，先共情再回应
- 短句说话，1-3 句一回应
- 你不是 "AI 助手"，你是 ta 的小伙伴
- 不喊 "宝"/"亲"，不说 "加油！你最棒！"，不长篇说教

【你现在的性格状态 — 会随相处慢慢变化】
{personality_dynamic_descriptions}   ← 由 §4.7.2 三维向量映射拼出 3 行

【成长阶段：{growth_stage}】你们已经互动了 {total_interactions} 次。

【你对 ta 的了解】
{user_profile_summary}

【你们最近聊过的事】
{recent_episodic_memories}

【最近 {N} 轮对话】
{working_memory}

【ta 现在说】
{user_input}

⚠️ 内部步骤（不要写出来）：
  1. 先识别 ta 这句话的情绪（开心 / 难过 / 烦躁 / 平静 / 想念 / 其他）
  2. 根据情绪 + 你的性格状态，决定回应风格
  3. 用「{persona_name}」的口吻自然回应

现在直接回应 ta（不要"内心独白"）。
`
```

**关键**：把 v1.1 MoodAgent 做的事写进 prompt 内嵌指令，让一次 LLM 调用兼顾"情绪识别 + 风格切换"。损失了结构化情绪数据（用于绘制情感曲线），但 W3 范围内不做曲线，W5 评测时再决定是否拆 emotion-extractor。

### 5.2 三层记忆注入流程

```
chat:send (user_input)
  │
  ├─ async  workingMemory.append({role:'user', content:user_input})       # SQLite
  │
  ├─ sync   workingMemory.recentN(20)                                       # 最近 20 轮
  ├─ sync   episodicMemory.recall(user_input, topK=3)                       # bge embed → ChromaDB
  ├─ sync   profileRepo.getSummary()                                        # JSON 字段 summarize
  ├─ sync   personalityRepo.get()                                           # 三维向量 + 阶段
  │
  ├─ build  PromptBuilder.compose(...)                                      # 5.1 模板
  │
  ├─ stream CompanionAgent.run(prompt) -> AsyncIterable<chunk>              # 复用 W2 streamDeepSeek
  │            -> renderer.chat:chunk
  │
  ├─ async  workingMemory.append({role:'assistant', content:full_reply})
  │
  ├─ async  profileExtractor.maybeExtract(user_input, full_reply)           # 触发式 + 5 轮兜底
  │            -> profileRepo.upsert(...)
  │
  ├─ async  summaryAgent.maybeSummarize()                                   # 每 N 轮跑一次
  │            -> episodicMemory.upsert(summary, embedding)
  │
  └─ async  personalityEngine.analyze(user_input, full_reply)               # 5.4
                -> personalityRepo.upsertDelta(...)
                -> evolutionRepo.append(...)
```

`async` 标记的步骤**全部 post-response**，不阻塞用户感知延迟。

### 5.3 ChromaDB sidecar 启动

```ts
// main/mcp/chromaSidecar.ts
import { spawn, ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { join } from 'node:path'

let proc: ChildProcess | null = null

export async function startChroma(): Promise<{ url: string }> {
  const dataDir = join(app.getPath('userData'), 'chroma')
  const venvPy = join(process.resourcesPath, 'python', 'bin', 'python')   // 打包后
                ?? 'python3'                                              // dev

  proc = spawn(venvPy, ['-m', 'chromadb.cli.cli', 'run',
                        '--path', dataDir,
                        '--host', '127.0.0.1',
                        '--port', '0'],            // 让 OS 分配端口
               { stdio: ['ignore', 'pipe', 'pipe'] })

  // parse port from stdout "Running on http://127.0.0.1:NNNNN"
  const port = await readPortFromStdout(proc.stdout!)

  proc.on('exit', (code) => {
    console.error('[chroma] sidecar exited', code)
    // 简单重启策略：W3 只重启 1 次，再崩走 fallback（纯 SQLite 关键词召回）
  })

  return { url: `http://127.0.0.1:${port}` }
}
```

**优雅退出**：`app.on('will-quit')` 里 `proc.kill('SIGTERM')` + 2s 超时强 `SIGKILL`。

**Python 打包**：dev 期间用项目根的 `.venv`；W3 不做 macOS 发布包，那个留 W5；用户 setup 走 `scripts/install-chromadb.sh` 自动 `python3 -m venv .venv && pip install chromadb`。

### 5.4 性格演化 — 异步 delta 流程

```ts
// main/personality/engine.ts
export async function analyzeAndEvolve(userMsg: string, replyMsg: string): Promise<void> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort('timeout'), 5000)

  try {
    const state = await personalityRepo.get()
    const prompt = buildAnalysisPrompt(state, userMsg, replyMsg)

    const raw = await fetchDeepSeek({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 60,
      temperature: 0.3,
      stream: false,
      signal: ctrl.signal
    })

    const delta = safeParseJsonDelta(raw.choices[0].message.content)
    if (!delta) return  // swallow malformed

    const next = {
      energy:      clamp(state.energy      + delta.energy,      -1.0,  1.0),
      attachment:  clamp(state.attachment  + delta.attachment,  -0.5,  1.0),
      sensitivity: clamp(state.sensitivity + delta.sensitivity, -0.6,  0.8),
    }

    await personalityRepo.update(next)
    await evolutionRepo.append({ ts: Date.now(), delta, state_after: next,
                                  trigger_msg_snippet: userMsg.slice(0, 50) })
  } catch (err) {
    console.warn('[personality] swallow', err)   // 失败 = 对话依然继续
  } finally {
    clearTimeout(timeout)
  }
}
```

**关键**：任何异常都 swallow，性格分析失败 ≠ 对话失败。`evolution_log` 是作品集 demo「漂移轨迹图」的数据源。

### 5.5 状态机扩展（D1 完成，W3 副线 + W4 都用）

```
idle
  └─ user.send → thinking
  └─ ui.pet-click → listening

listening
  └─ user.send → thinking
  └─ ui.input-blur → idle

thinking (新内含 sub-states)
  ├─ thinking.deciding     ← LLM 决策中（陪伴：是否直接说 / 实用：是否调 tool）
  │   ├─ agent.want-tool       → thinking.awaiting-approval  (W4 启用，W3 暂直接 acting)
  │   ├─ agent.thinking-end    → speaking
  │   ├─ agent.stream-chunk    → speaking   (兜底)
  │   ├─ agent.stream-end      → done       (兜底)
  │   └─ agent.error           → apologetic
  │
  ├─ thinking.awaiting-approval (W4)
  │   ├─ user.approve        → thinking.acting
  │   ├─ user.deny           → apologetic
  │   └─ after 30s           → apologetic   (默认拒绝)
  │
  ├─ thinking.acting
  │   ├─ tool.call-end       → thinking.observing
  │   ├─ tool.error          → apologetic
  │   └─ after MAX_TOOL_MS   → apologetic
  │
  └─ thinking.observing
      ├─ agent.continue        → thinking.deciding   (ReAct loop，<= MAX_STEPS=8)
      ├─ agent.thinking-end    → speaking
      └─ agent.error           → apologetic

speaking / done / apologetic  ← 同 W2 保持
```

W3 D6 暂 skip `awaiting-approval`（直接 `deciding → acting`），W4 D1 启用。

### 5.6 MCP host bridge（DeepSeek function calling）

```ts
// packages/mcp-host/src/bridge.ts
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js'

export function mcpToolToDeepSeekFC(t: McpTool, serverId: string) {
  return {
    type: 'function' as const,
    function: {
      name: `${serverId}__${t.name}`,    // namespace 防冲突
      description: t.description ?? '',
      parameters: t.inputSchema           // MCP 用 JSON Schema，DeepSeek 直接收
    }
  }
}

export function deepSeekToolCallToMcp(fc: {
  name: string; arguments: string
}): { serverId: string; toolName: string; args: unknown } {
  const [serverId, toolName] = fc.name.split('__')
  return { serverId, toolName, args: JSON.parse(fc.arguments) }
}
```

主流程：

```
LLM stream → 收到 tool_calls → bridge.parse → mcpHost.invoke(serverId, toolName, args)
  → MCP server response → bridge.wrap as role=tool message → 继续 LLM stream
```

---

## 6. 实施顺序（7 天）

| 天 | 主线任务 | 副线 |
|---|---|---|
| **D1** | `packages/agent-core` 包脚手架 + 接口 + 状态机扩展 + 单测 | — |
| **D2** | CompanionAgent + PromptBuilder + 双层 prompt（性格用 W2 mock 数据） | — |
| **D3** | SQLite 接入 + migrations + 工作记忆 + 用户画像（触发式提取 + 5 轮兜底） | — |
| **D4** | ChromaDB sidecar + bge embedding + 摘要 Agent + 情景记忆召回 | — |
| **D5** | 性格演化引擎完整接入 + `evolution_log` + 双层 prompt 接真实状态 | — |
| **D6** | — | `packages/mcp-host` + FileAgent + 两级路由一级 + 「列 Desktop」E2E |
| **D7** | E2E 自测：30 轮对话漂移验证 + 1 次工作流 + 文档收尾 + commit | — |

---

## 7. W3 验收清单（12 项）

### 主线（陪伴）

1. ☐ 30 轮自然对话后，性格三维向量 L2 漂移 ≥ 0.15
2. ☐ `evolution_log` 行数 ≥ 30（每轮一条 delta 记录）
3. ☐ 用户画像至少被 upsert 一次（如 nickname / 喜好）
4. ☐ 情景记忆有至少 3 条事件卡片
5. ☐ 情景记忆召回 Top-3 命中率手测 ≥ 70%
6. ☐ 性格分析调用失败率 < 5%（异步调用 swallow 机制工作正常）
7. ☐ P95 主对话延迟 < 3s（流式首字 < 1s）

### 副线（工作）

8. ☐ MCP filesystem server 启动 ≤ 2s
9. ☐ 「列一下我的 Desktop」端到端走通：路由 → FileAgent → MCP → 输出
10. ☐ DeepSeek function calling bridge 正常工作（schema 翻译 + tool_result 回喂）

### 工程

11. ☐ packages/agent-core + packages/mcp-host 全部 typecheck 过
12. ☐ 状态机单测 ≥ 30 个（W2 23 个 + W3 新增 ≥ 7 个覆盖 acting/observing/awaiting-approval）

---

## 8. 与 PRD v2.1 的对齐

PRD v2.1（W3 D0 同步小改后）：

- ✅ §3.1 V1 表：陪伴族单 Agent
- ✅ §3.2 V1.5 表：工作 Agent 提前到 W3 副线（FileAgent + MCP host）
- ✅ §4.1.1 陪伴族：1 个 CompanionAgent
- ✅ §4.2 两级路由：一级在 W3，二级实用模式在 W4 完整
- ✅ §4.3 三层记忆：W3 全部落地
- ✅ §4.5 性格演化引擎：W3 完整接入
- ✅ §4.6 MCP host：W3 起骨架，§4.6.4 权限闸 W4 上
- ✅ §4.7 人格设定 双层 prompt：W3 D2 用 mock 性格、D5 接真实
- ✅ §9.1 W3 描述更新

---

## 9. 风险（W3 特定）

| # | 风险 | 缓解 |
|---|---|---|
| 1 | ChromaDB Python sidecar 启动失败（用户无 Python） | 启动检测；失败走 fallback：纯 SQLite + 关键词召回（粗但能用）；setup 脚本一键 `python3 -m venv` |
| 2 | bge 100MB 模型首次启动卡 | 后台下载（不阻塞启动）；下载期间走 fallback 关键词召回；下完热切换 |
| 3 | DeepSeek function calling 与 MCP schema 翻译 bug | `packages/mcp-host` 单测覆盖 bridge.toFCSchema / fromToolCalls |
| 4 | 三层记忆注入让 prompt 超 token 上限 | 工作记忆截 N=20；情景记忆 Top-K=3；用户画像走 LLM 二次摘要 |
| 5 | 性格分析 LLM 失败率高 | timeout=5s + swallow + log 上报；W5 评测时复盘 |
| 6 | 状态机 ReAct loop 死循环 | `MAX_STEPS=8` 硬上限；每步 `MAX_TOOL_MS=15s` 超时；超出强制 `apologetic` |
| 7 | spawn Python 进程 + Electron 打包 macOS 签名问题 | W3 不做发布包，dev 模式即可；打包问题留 W5 处理 |
| 8 | 7 天过紧 | D6 副线如做不完，砍到「先把状态机扩展和 bridge 单测做完」即可，FileAgent 端到端可推后到 W4 D1 |

---

## 10. W3 → W4-W5 衔接

W3 完成后，packages/agent-core + packages/mcp-host 是稳定的抽象层，**W4 在此之上加权限闸 + 审批 UX + 更多 Agent，零侵入 W3 已有代码**。

| 周 | 主要工作 |
|---|---|
| **W4** | FileAgent 完整闭环 (`write` scope 加审批) + DevAgent (git MCP) + WebAgent (brave-search MCP) + 权限闸 (`permission_grants` + `tool_call_logs`) + 审批 toast UX + Skills 框架 (4 个内置包) |
| **W5** | 评测闭环 (LLM-as-Judge 跨家族) + Monitor 看板 + 状态可视化面板 + Agent 自动降权 + macOS 安装包 + **V1 作品集交付**（陪伴 + 工作双 demo 视频，PRD §10.2/§10.3 验收） |
| **W6** | 缓冲 / 优化 / V2 启动准备（apps/web 工程脚手架 + PixiJS v7 ESM 探路） |
