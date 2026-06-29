# W4 技术方案 · 实用 Agent 族完整闭环 + 权限审批

> 状态：规划中 · 前置：W1 ✅ W2 ✅ W3 ✅（D1–D6 + 文件喂养加餐）· 周期：~7 天
>
> 目标：把 W3 副线「FileAgent read-only + 自动放行」升级为**完整的实用 Agent 族 + 统一权限闸 + 审批 UX**：
> - **权限闸**：scope 四档（read/write/exec/network）× 授权三档（一次/会话/永久），所有 `write`/`exec`/`network` 默认弹审批
> - **审批 UX**：复用 W3 已建的状态机 `awaitingApproval` sub-state，接上桌宠询问态 + 气泡 + toast 四按钮 + 30s 默认拒绝
> - **更多 Agent**：FileAgent `write` scope、SystemAgent（自建 stdio MCP server）、DevAgent（`mcp-server-git`）
> - **Skills 框架**：3 个内置包（开发者助手 / 文件管家 / 裸装），设置面板加 Skills/Tools/Permissions 三 tab
> - **两级路由二级**：实用模式下选具体 Agent（LLM 选 + 关键词补强）
>
> 设计原则：W4 在 `packages/agent-core` + `packages/mcp-host` 抽象层之上**零侵入扩展**。状态机扩展（`acting/observing/awaitingApproval`）与 `inferScope/scopeOf` 已在 W3 落地，W4 只补「权限存储 + 审批回环 + UI + 新 server 配置」。

---

## 1. W4 范围（In Scope）

### 主线 A：统一权限闸 + 审批 UX

| 模块 | 功能 | 优先级 | 复用/新增 |
|---|---|---|---|
| **scope 推断** | 命名空间工具名 → scope | P0 | ✅ W3 已有 `mcp-host.inferScope/scopeOf` |
| **状态机 awaitingApproval** | 审批 sub-state + `user.approve/deny` + 30s 超时 | P0 | ✅ W3 已建，W4 接 UI |
| **PermissionGate** | 查 grants → 命中放行 / 未命中转审批；scope×三粒度匹配 | P0 | 🆕 |
| **grants 存储** | `permission_grants` 表 + 会话内存层 + 永久持久层 + 撤销 | P0 | 🆕 |
| **ToolCallLogger** | 每次 tool_call（成功/失败/拒绝）写 `tool_call_logs` | P0 | 🆕 |
| **审批 IPC + UX** | 主进程发审批请求 → renderer 询问态 motion + 气泡 + toast → 回 approve/deny | P0 | 🆕 |

### 主线 B：实用 Agent 族

| 模块 | 功能 | 优先级 | 挂载 server |
|---|---|---|---|
| **FileAgent (write)** | 在白名单目录建/移/改文件，经审批 | P0 | `@modelcontextprotocol/server-filesystem` |
| **SystemAgent** | 剪贴板读写、系统通知 | P1 | 自建 Node stdio MCP server |
| **DevAgent** | git status/log/diff/commit/branch | P1 | `mcp-server-git` |
| **两级路由二级** | 实用模式选 File/System/Dev | P0 | agent-core 扩 `intent-router` 二级 |

### 主线 C：Skills 框架 + 设置三 tab

| 模块 | 功能 | 优先级 |
|---|---|---|
| **Skills 定义** | 3 内置包 = MCP server 组合 + prompt_addon + 默认权限 | P0 |
| **skills / mcp_servers 表** | 启用态持久化；启用 Skill = upsert skill 行 + 关联 server 置 enabled | P0 |
| **设置 Skills tab** | 4 卡片 ON/OFF | P0 |
| **设置 Tools tab** | 激活 server 列表（transport/命令/健康/工具数）+ 重启/移除 | P0 |
| **设置 Permissions tab** | grants 清单 + 撤销；tool_call_logs 审计（筛选 agent/scope/time）+ 导出 JSON | P0 |

### 收尾

| 模块 | 功能 |
|---|---|
| **E2E 自测** | 「整理 Desktop」write 审批 + 「git status」跨族协作 + Skills 切换 + 撤销 grant 重新审批 |
| **文档** | `W4-TECH-PLAN.md` 收尾 + README W4 一节 + PRD §9.2 状态更新 |
| **commit + 双仓推送** | 同 W3 流程（origin + woa，lilliechen 身份） |

## 2. Out of Scope（W4 不做）

- ❌ 评测闭环 / LLM-as-Judge → **W5**
- ❌ Monitor 看板 / 状态可视化（三维性格条 + 漂移轨迹）→ **W5**
- ❌ Agent 自动降权 → **W5**
- ❌ macOS 安装包 / 签名 → **W5**
- ❌ **WebAgent（`brave-search` / `tavily` 网页搜索）→ 推迟**（需第三方 API key + 出站网络，作品集价值低于本地工具族；按需在 V2 或后续补）
- ❌ 研究助手 Skill（依赖 WebAgent）→ 随 WebAgent 一起推迟
- ❌ 情景记忆 ChromaDB + bge 语义召回（W3 用 SQLite 关键词召回代替，技术债登记在 §9）→ **W5 复盘是否补**
- ❌ Web 端 Skills capability 裁剪 → **W7**
- ❌ 自定义 Skill JSON 导入 → **V2**

---

## 3. 依赖增项

### 桌面端

```jsonc
// apps/desktop/package.json — 新增
{
  "dependencies": {
    // DevAgent 用社区 MCP server，运行时 npx/uvx 拉起，无需打包依赖；
    // 建议显式声明便于锁版本：
    "@modelcontextprotocol/server-filesystem": "*"  // W3 已用
    // mcp-server-git：运行时 uvx/npx 拉起，不进打包依赖
  }
}
```

> DevAgent 的 `mcp-server-git` 是 Python 包（`uvx mcp-server-git`）或社区 Node 等价物——W4 实施时二选一，优先无额外运行时依赖的方案；缺失则 Tools tab 标「不可用」，不阻塞陪伴。

### 新增/改动 workspace 包

```
packages/agent-core/src/
  intent-router.ts        # 改：补二级路由（实用模式 → File/System/Dev）
  permission.ts           # 🆕 纯逻辑：grant 匹配（scope + target_pattern + 过期/撤销判定）
  skills.ts               # 🆕 纯逻辑：4 内置包定义 + Skill→server 解析
  index.ts                # 改：导出新模块

packages/mcp-host/src/
  host.ts                 # 改：支持多 server（git/system）；按 enabled 动态 spawn
  (inferScope/scopeOf 已就绪)

packages/system-mcp-server/  # 🆕 自建 stdio MCP server（剪贴板/通知）
  src/index.ts
  package.json
```

---

## 4. 文件清单

### 新增

```
packages/agent-core/src/permission.ts          # grant 匹配纯逻辑 + 单测
packages/agent-core/src/skills.ts              # Skill 定义 + 解析 + 单测
packages/system-mcp-server/                     # 自建 system MCP server

apps/desktop/src/main/
  permission/
    gate.ts                                      # PermissionGate：查 grants → 放行/转审批
    grantStore.ts                                # 会话内存 + permission_grants 持久层 + 撤销
    approvalBridge.ts                            # 审批请求 ↔ renderer IPC（resolve/reject + 30s）
  db/
    repo-grants.ts                               # permission_grants CRUD
    repo-tool-logs.ts                            # tool_call_logs append + 查询（筛选/分页）
    repo-skills.ts                               # skills + mcp_servers CRUD
  agents/
    fileAgentWrite.ts                            # FileAgent write 能力（沿用 W3 ReAct）
    devAgentClient.ts                            # DevAgent（git server 配置 + 调用）
  mcp/
    serverRegistry.ts                            # 内置 server 配置表（fs/git/system）
```

### 改动

```
apps/desktop/src/main/
  index.ts                                       # chat:send 接 PermissionGate + ToolCallLogger；
                                                 # 二级路由选 Agent；新增 IPC：
                                                 #   permission:respond / skills:* / tools:* / perm:*
  llm.ts                                         # （W3 已支持 tools，基本无改动）
  db/migrations.ts                               # 加 002：skills/mcp_servers/permission_grants/tool_call_logs

apps/desktop/src/preload/index.ts               # 暴露 permission/skills/tools/perm-logs API
apps/desktop/src/renderer/src/
  App.tsx                                        # 接 awaitingApproval：询问态 + 审批 toast
  components/ApprovalToast.tsx                   # 🆕 [本次][本会话][永久][拒绝]
  components/SettingsTabs/                        # 🆕 Skills / Tools / Permissions 三 tab
  live2d/...                                      # 询问态 motion（轻微歪头；W4 可用占位动效）

packages/state-machine/                          # awaitingApproval 已就绪，预计无改动（按需补测试）
```

---

## 5. 关键技术点

### 5.1 PermissionGate 决策流（接 W3 状态机）

```
LLM 产出 tool_call(fcName, args)
  ↓
scope = mcpHost.scopeOf(fcName)                 # W3 已有
target = extractTarget(fcName, args)            # 如 write_file 的 path、git.commit 的 repo
  ↓
gate.check({ scope, target, agent })
  ├─ scope === 'read'                    → 放行（read 默认免审批）
  ├─ grantStore.match(scope, target)     → 命中且未过期/未撤销 → 放行（状态机不切）
  └─ 未命中 → 状态机 send {type:'agent.want-tool'} → thinking.awaitingApproval
                ↓ approvalBridge.request(...) （Promise，30s 超时默认 deny）
                ↓ renderer 询问态 + toast
        ├─ 本次   → 放行（不写 store）
        ├─ 本会话 → grantStore.addSession(scope, target) → 放行
        ├─ 永久   → repo-grants.insert(...) + grantStore 缓存 → 放行
        └─ 拒绝/超时 → tool 标 denied → 状态机 user.deny → apologetic
  ↓（放行后）
mcpHost.invoke(...) → ToolCallLogger.log({ok, latency, ...}) → 状态机 tool.call-end → observing
```

`grantStore` 三层：内存 `Map`（会话级）+ `permission_grants` 表（永久）。`match` 用 scope 精确 + `target_pattern` 前缀/glob 匹配（如 `~/Desktop/**`）。

### 5.2 审批 IPC 回环

```
主进程 approvalBridge.request(req): Promise<Decision>
  → 生成 reqId，存 pending Map，event.sender.send('permission:request', {reqId, scope, target, agentName, toolName})
  → setTimeout(30s) → resolve('deny', 'timeout')

renderer 收到 permission:request
  → state.send({type:'agent.want-tool'})（进 awaitingApproval）
  → 显示 ApprovalToast + 气泡文案（"要不要让我写文件到 ~/Desktop/... ？"）
  → 用户点击 → ipc.permission.respond(reqId, grade)  # grade: once|session|forever|deny

主进程 ipcMain.handle('permission:respond') → pending.get(reqId).resolve(grade) → clearTimeout
```

状态机事件：`agent.want-tool` → awaitingApproval；`user.approve` → acting；`user.deny` → apologetic（均 W3 已定义）。

### 5.3 Skills 框架（PRD §4.6.3）

```ts
// packages/agent-core/src/skills.ts
export interface SkillDef {
  id: 'dev' | 'file-butler' | 'bare'
  name: string
  servers: string[]          // serverRegistry 的 id
  promptAddon: string        // 注入 system prompt 的偏好描述
  defaultScopes: ToolScope[] // 默认免审批的 scope（仍受 gate 兜底）
}
```

| Skill | servers | 默认权限 |
|---|---|---|
| 🧑‍💻 开发者助手 | git + filesystem(`~/Projects`) | read + 项目目录 exec/write 审批 |
| 📁 文件管家 | filesystem(`~/Desktop`) | read + write 审批 |
| 🎒 裸装 | — | 仅陪伴，无工具 |

启用 Skill：`repo-skills.enable(id)` → upsert skill 行 + 关联 `mcp_servers` 置 enabled → `mcpHost` 动态 spawn。

### 5.4 数据表（migration 002，PRD §4.6.6）

```sql
skills(id, name, enabled, included_servers TEXT, prompt_addon, created_at)
mcp_servers(id, name, transport, command, args TEXT, env TEXT, capabilities TEXT,
            status, last_ping_at, enabled)
permission_grants(id, scope, target_pattern, agent_name, server_id,
                  granted_at, expires_at, revoked_at)        -- expires_at NULL=永久
tool_call_logs(id, ts, agent_name, server_id, tool_name, args_summary,
               result_summary, ok, latency_ms, denied_reason) -- append-only + 索引(ts)
```

### 5.5 两级路由二级（agent-core intent-router 扩展）

```
一级（W3 已有）：companion vs utility（关键词 + LLM 兜底）
二级（W4 新增，仅 utility）：
  - 关键词补强：'git'/'commit'/'分支' → dev；'剪贴板'/'通知' → system；
    '文件'/'整理'/'重命名' → file
  - 兜底 LLM zero-shot 单选 + tools_hint
```

---

## 6. 实施顺序（7 天）

| 天 | 任务 |
|---|---|
| **D1** | migration 002（4 张表）+ repo-grants/tool-logs/skills + agent-core `permission.ts` 纯逻辑 + 单测 |
| **D2** | PermissionGate + grantStore（内存+持久）+ ToolCallLogger，接入 chat:send 工具调用链路（先无 UI，read 放行/write 直接 deny 验证 gate） |
| **D3** | 审批 IPC 回环（approvalBridge + preload + 30s 超时）+ renderer ApprovalToast + 询问态；「写文件到 Desktop」审批 E2E 跑通 |
| **D4** | FileAgent write 闭环 + serverRegistry + 两级路由二级；DevAgent（git server 接入）read 路径跑通 |
| **D5** | Skills 框架（4 内置包 + skills/mcp_servers 表 + 动态 spawn）+ 设置 Skills tab |
| **D6** | 设置 Tools tab（server 健康/重启/移除）+ Permissions tab（grants 撤销 + 审计日志筛选/导出）+ SystemAgent |
| **D7** | E2E 自测（整理 Desktop / git status / Skills 切换 / 撤销 grant 重审批）+ 文档收尾 + commit + 双仓推送 |

---

## 7. W4 验收清单

### 权限闸 + 审批
1. ☐ `read` scope 工具调用无感放行（状态机不进 awaitingApproval）
2. ☐ `write`/`exec`/`network` 未授权时必弹审批 toast
3. ☐ 「本会话」授权后，同 (scope, target) 当次进程内不再弹
4. ☐ 「永久」授权写入 `permission_grants`，重启后仍生效
5. ☐ 拒绝 / 30s 超时 → 进 apologetic（"好，不动了"）
6. ☐ Permissions tab 可撤销 grant，撤销后再次调用重新弹审批
7. ☐ 每次 tool_call（成功/失败/拒绝）都有 `tool_call_logs` 记录

### Agent 族
8. ☐ 「整理一下我 Desktop 的截图」→ FileAgent write，经审批后执行
9. ☐ 「这个项目 git status」→ 二级路由判 DevAgent，read 直放行
10. ☐ 两级路由二级在 3 类 utility 意图（File/System/Dev）上选对 Agent（手测 ≥ 80%）

### Skills + 设置
11. ☐ 设置 Skills tab 切换「文件管家」ON/OFF，对应 server enabled 状态联动
12. ☐ Tools tab 显示激活 server 健康状态 + 工具数
13. ☐ Permissions tab 审计日志可按 agent/scope/time 筛选 + 导出 JSON

### 工程
14. ☐ agent-core `permission.ts` / `skills.ts` 单测全过
15. ☐ 全仓 typecheck + 单测全过；双仓推送成功

---

## 8. 与 PRD v2.1 的对齐

- ✅ §3.1 V1.5 表：W4 = FileAgent 完整 + DevAgent + 权限闸 + 审批 UX + Skills + 三 tab（**WebAgent 推迟，见 §2**）
- ✅ §4.6.2 权限闸架构（scope check + grant store + ToolCallLogger）
- 🟡 §4.6.3 Skills：W4 落 3 内置包（研究助手随 WebAgent 推迟）
- ✅ §4.6.4 权限模型（scope 四档 × 授权三档 + 审批时序 + 默认拒绝）
- ✅ §4.6.5 设置三 tab（Skills/Tools/Permissions）
- ✅ §4.6.6 数据表（skills/mcp_servers/permission_grants/tool_call_logs）
- ✅ §4.2 两级路由二级
- ✅ §9.2 W4 描述

---

## 9. 技术债登记（来自 W3）

| # | 债 | 影响 | 计划 |
|---|---|---|---|
| 1 | 情景记忆走 SQLite 关键词召回，非 ChromaDB + bge 语义召回 | 召回精度受限于关键词命中 | W5 评测时复盘是否补；接口（agent-core `EpisodicMemory`）已抽象，替换成本可控 |
| 2 | 拖放在透明置顶窗口失效，已降级为 📎 文件选择框；窗口层级从 `screen-saver` 降到 `floating` | 拖放 UX 缺失；置顶层级略低 | W4/W5 评估原生拖放方案或保持现状 |

---

## 10. 风险（W4 特定）

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 审批回环死锁（renderer 不响应 / 进程退出）| approvalBridge 强制 30s 超时 → 默认 deny；进程退出清 pending |
| 2 | `mcp-server-git` 运行时依赖（Python uvx / Node）缺失 | serverRegistry 标健康状态；缺失时 Tools tab 显「不可用」+ 引导安装，不阻塞陪伴 |
| 3 | grant target_pattern 匹配过宽（安全）| 永久授权按精确目录/glob 存；read 才默认放行，write/exec 一律走 gate |
| 4 | tool_call_logs 膨胀 | append-only + ts 索引；30 天自动清理（PRD §8.1） |
| 5 | 自建 system MCP server 跨平台（剪贴板/通知）| W4 先实现 macOS；其它平台标 degraded |
| 6 | 7 天偏紧 | P1 的 SystemAgent 可后置；P0 = 权限闸 + 审批 UX + FileAgent write + Skills + 三 tab 必须完成 |

---

## 11. W4 → W5 衔接

W4 完成后，权限闸 + 审批 + 多 Agent + Skills 齐全，**实用族闭环成立**。W5 在此之上加评测（LLM-as-Judge 用 `tool_call_logs` 作输入）、Monitor 看板、状态可视化、Agent 自动降权（基于审计日志命中率），并出 V1+V1.5 联合 demo 视频 + macOS 安装包。
