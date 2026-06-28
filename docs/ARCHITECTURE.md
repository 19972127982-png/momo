# EchoPet 架构总览 · v2.0

<p align="center">
  <a href="https://www.figma.com/board/FOXNk5qPRm7BZ98dp7YwF7">
    <img src="./img/architecture-overview.svg" alt="EchoPet v1.1 架构总览图（v2.0 升级图见 §9 §10）" width="900"/>
  </a>
  <br/>
  <em>v1.1 同步主链路（实线） · 双异步反馈（点线） · 跨轮反馈 — v2.0 在 §9/§10 加三端拓扑 + MCP host 拓扑 mermaid 图</em>
  <br/>
  <strong><a href="https://www.figma.com/board/FOXNk5qPRm7BZ98dp7YwF7">→ 在 FigJam 中打开（可编辑 · 可导出 PNG / SVG）</a></strong>
</p>

> 配套文档：[PRD.md](PRD.md)（v2.0）
>
> 本文是作品集 README 的素材源。v1.1 架构总览图（顶图）用 Figma 出 SVG，**v2.0 新增的三端拓扑图 (§9) 和 MCP host 拓扑图 (§10) 直接用 mermaid GitHub 原生渲染**，其余结构图、时序图、存储拓扑均同。
>
> **v2.0 新增章节**：§8 v1.0→v1.1→v2.0 升级摘要 · §9 三端部署拓扑 · §10 MCP host + 权限闸 拓扑

---

## 1. 一句话定位

EchoPet 是一只**有记忆、有人格、有反应**的桌面 Live2D 桌宠，基于 EchoMind 架构 + ai-pet 的性格自适应设计。

---

## 2. 四 + 一模块总览图

```mermaid
flowchart TB
    User((("用户输入<br/>文字 / 事件")))

    subgraph sync ["━━━ 同步主链路 · 每轮对话执行一次 ━━━"]
        direction TB
        Router{{"① 三路融合意图识别<br/>━━━━━━━━<br/>LLM 语义 (0.5)<br/>向量相似度 (0.3)<br/>关键词规则 (0.2)<br/>━━━━━━━━<br/>加权投票 → intent, confidence"}}
        Orchestrator["② 多 Agent 编排<br/>━━━━━━━━<br/>ChatAgent · MoodAgent · MemoryAgent<br/>━━━━━━━━<br/>单一 / 并行 / 串行 调用"]
        MemInject[("③ 三层记忆注入<br/>━━━━━━━━<br/>工作记忆 (最近 20 轮)<br/>情景记忆 (向量召回 Top-K)<br/>用户画像 (Top-K 摘要)")]
        Persona[/"④a 双层人格注入<br/>━━━━━━━━<br/>静态底色 小桃 (不漂移)<br/>动态修饰 energy / attachment / sensitivity<br/>━━━━━━━━<br/>+ 成长阶段 + 当前情绪"/]
        LLM(["LLM 流式生成<br/>━━━━━━━━<br/>DeepSeek-V3<br/>(deepseek-chat)"])
    end

    Output((("桌宠输出<br/>━━━<br/>Live2D 表情/动作<br/>+ 文字气泡 打字机效果")))

    subgraph async ["━━━ 异步反馈双通路 · post-response 非阻塞 ━━━"]
        direction LR
        Eval{{"④b 评测闭环<br/>━━━━━━━━<br/>LLM-as-Judge<br/>(必须跨家族 Provider)<br/>━━━━━━━━<br/>共情度 · 人格一致性 · 记忆准确度"}}
        PEngine{{"⑤ 性格演化引擎 · NEW v1.1<br/>━━━━━━━━<br/>三维向量 delta 漂移<br/>±0.02 / 轮 · 异步触发<br/>━━━━━━━━<br/>成长阶段自动推导"}}
    end

    subgraph store ["━━━ 本地存储 · 全在用户机器上 ━━━"]
        direction LR
        SQLite[("SQLite<br/>━━━<br/>user_profile<br/>conversation_messages<br/>pet_personality<br/>evolution_log<br/>agent_eval_logs<br/>system_metrics")]
        Chroma[("ChromaDB<br/>━━━<br/>episodic_memories<br/>+ embedding 向量")]
        Keychain[("OS Keychain<br/>━━━<br/>API Keys<br/>(macOS Keychain<br/>/ Windows Credential)")]
    end

    User ==> Router
    Router ==> Orchestrator
    Orchestrator <==> MemInject
    MemInject ==> Persona
    Persona ==> LLM
    LLM ==>|"流式 token"| Output

    Output -.->|"async 触发"| Eval
    Output -.->|"async 触发"| PEngine

    Eval -.->|"路由权重反馈"| Orchestrator
    PEngine -.->|"性格状态更新"| Persona

    MemInject -.- SQLite
    MemInject -.- Chroma
    PEngine -.- SQLite
    Eval -.- SQLite
    LLM -.- Keychain
```

**读图约定**：

- **节点形状**：圆圈 `User / Output` = 入口/出口事件；六边形 `Router / Eval / PEngine` = 决策与分析模块；圆角矩形 `Orchestrator` = 编排；圆柱 `MemInject / SQLite / Chroma / Keychain` = 数据层；平行四边形 `Persona` = 数据注入装配；胶囊 `LLM` = 外部 API 调用
- **箭头粗细**：**粗箭头** `==>` 表示同步主链路（阻塞，一次对话期间执行）；**点线** `-.->` 表示异步反馈或存储读写（不阻塞主对话）
- **三个 subgraph 分区**：同步主链路 (① ~ ④a) / 异步反馈双通路 (④b + ⑤) / 本地存储——分别对应**用户体验、自我进化、数据持久化**三个关注点

**核心叙事**：两条 post-response 反馈通路互补——

- **评测闭环**回答"哪个 Agent 答得好"，反馈到路由权重
- **性格演化引擎**回答"它该变成什么样的桌宠"，反馈到人格状态

这是 EchoPet v1.1 在 EchoMind 之上的关键升级，也是这个项目作品集叙事的核心。

---

## 3. 单轮对话的完整数据流（时序图）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant R as ① Intent<br/>Router
    participant O as ② Agent<br/>Orchestrator
    participant M as ③ Memory<br/>Layer
    participant P as ④a Persona<br/>Layer (双层)
    participant LLM as DeepSeek-V3
    participant View as Live2D + UI
    participant Eval as ④b Eval<br/>Loop
    participant PE as ⑤ Personality<br/>Engine
    participant DB as SQLite<br/>+ ChromaDB

    Note over U, View: 同步主链路 · 用户感知延迟期内必须完成

    U->>+R: 用户消息
    R->>R: 三路融合<br/>(LLM 0.5 + Vec 0.3 + KW 0.2)
    R-->>-O: intent + confidence

    activate O
    O->>+M: 请求三层记忆
    M-->>-O: 工作记忆 + 情景召回 + 画像摘要
    O->>+P: 请求人格 prompt 片段
    P->>+DB: 读 pet_personality (三维向量)
    DB-->>-P: 当前状态
    P-->>-O: 静态底色 + 动态修饰文本
    O->>+LLM: 完整 prompt + 流式请求
    LLM-->>-View: 流式 token (打字机)
    deactivate O
    View-->>U: 桌宠回应<br/>(Live2D 表情 + 文字气泡)

    Note over View, DB: 异步反馈双通路 · 主对话已结束，下面这些都不阻塞 UI

    par 通路一：评测闭环 (④b)
        View->>+Eval: 触发 LLM-as-Judge
        Eval->>Eval: 跨家族 Provider 打分<br/>共情度 / 人格一致性 / 记忆准确度
        Eval->>DB: 写入 agent_eval_logs
        Eval-->>-O: 更新下一轮路由权重
    and 通路二：性格演化 (⑤)
        View->>+PE: 触发性格分析
        PE->>LLM: 小请求<br/>(max_tokens=60, temp=0.3)
        LLM-->>PE: JSON delta<br/>{energy, attachment, sensitivity}
        PE->>PE: clamp 软上限<br/>累加到当前状态
        PE->>DB: upsert pet_personality<br/>append evolution_log
        PE-->>-P: 下一轮 Persona 自动读到新状态
    end
```

**关键工程细节**：

- 第一段（autonumber 1-9）是**同步阻塞**：每一步都在用户感知延迟内完成，所以 Memory 取摘要要快、Persona 拼接是 O(1) 字符串操作、LLM 必须流式
- 第二段（par 两支）是**完全异步**：主对话已经返回给用户了，这两条通路在后台独立跑，任一失败都不影响主对话，只 swallow 异常并记日志
- 反馈结果在 **下一轮**才生效，不是当前轮——这是闭环设计的关键约束（如果当前轮就用，会形成不稳定的同轮反馈震荡）
- LLM 在两条通路里被调用了 3 次：主对话 1 次（大）+ 评测 1 次（中，跨家族）+ 性格分析 1 次（小，60 tokens）。这个分布在 § 5.1 取舍点里有讨论

---

## 4. 性格演化引擎细节

### 4.1 三维向量

| 维度 | -1 端 | +1 端 | 初始锚点 | 软上限 |
|---|---|---|---|---|
| energy | 安静内敛 | 活泼好动 | 0.0 | [-1, +1] 全开 |
| attachment | 独立高冷 | 粘人撒娇 | +0.2 | [-0.5, +1.0] |
| sensitivity | 钝感力强 | 高敏感共情 | -0.3 | [-0.6, +0.8] |

### 4.2 触发规则

| 用户行为信号 | 维度变化 | 单轮幅度 |
|---|---|---|
| 话多、热情、感叹号多 | energy ↑ | +0.01 ~ +0.02 |
| 话少、深夜、回复简短 | energy ↓ | -0.01 ~ -0.02 |
| 频繁来聊、表达想念/依赖 | attachment ↑ | +0.01 ~ +0.02 |
| 长时间不来、冷淡简短 | attachment ↓ | -0.01 ~ -0.02 |
| 细腻表达情绪、需要被看见 | sensitivity ↑ | +0.01 ~ +0.02 |
| 务实/直球沟通/不喜过度共情 | sensitivity ↓ | -0.01 ~ -0.02 |

### 4.3 成长阶段

| 阶段 | 阈值 | 桌宠状态 |
|---|---|---|
| 初识 | < 30 次 | 好奇拘谨，慢慢了解 |
| 熟悉 | < 100 次 | 展现真实性格 |
| 亲密 | < 250 次 | 完全信任，会撒娇任性 |
| 挚友 | ≥ 250 次 | 主动关心，深度了解 |

---

## 5. 双层 Prompt 拼接示意

完整 system prompt 的结构如下：

```
┌─────────────────────────────────────────────────────────┐
│  第一层：静态底色（写死，永远成立）                       │
│  - 你是「小桃」，住在桌面的小伙伴                         │
│  - 温暖、轻倾听，先共情再回应                             │
│  - 短句说话，1-3 句一回应                                 │
│  - 不喊"宝"、"亲"、不说"加油！"、不长篇说教               │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  第二层：动态修饰（由性格演化引擎驱动）                   │
│  - 你性格开朗，喜欢和主人互动      ← energy = 0.35       │
│  - 你喜欢粘着主人，会主动找话题    ← attachment = 0.42   │
│  - 你比较稳，能感知但不放大情绪    ← sensitivity = -0.18 │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  成长上下文                                              │
│  【成长阶段：熟悉】你们已经互动 67 次                     │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  记忆注入                                                │
│  【你对 ta 的了解】(用户画像摘要)                         │
│  【你们最近聊过的事】(情景记忆 Top-K)                     │
│  【ta 现在的情绪】(MoodAgent 输出)                        │
└─────────────────────────────────────────────────────────┘
```

**为什么是双层**：纯漂移设计（ai-pet 的方案）可能让温暖系桌宠在用户长期开玩笑后变成毒舌系，体验跳脱不连贯。双层保证人格基线稳定，只让风格细节漂移。这是个典型的"鲁棒性 vs 灵活性"取舍。

---

## 6. 数据存储拓扑

```mermaid
flowchart LR
    subgraph SQLite [SQLite better-sqlite3]
        UP[user_profile]
        CM[conversation_messages]
        PP[pet_personality]
        EL[evolution_log]
        AEL[agent_eval_logs]
        SM[system_metrics]
    end
    subgraph Chroma [ChromaDB 嵌入式]
        EM[episodic_memories<br/>含 embedding]
    end
    subgraph Keychain [OS Keychain]
        KEYS[API Keys]
    end

    UP -.读.-> Persona[Persona 注入]
    PP -.读.-> Persona
    EM -.向量召回.-> Memory[Memory 注入]
    CM -.最近 N 轮.-> Memory
    EL -.append.-> PE[Personality Engine]
    AEL -.append.-> Eval[Eval Loop]
    KEYS -.读.-> LLM[LLM Client]
```

**所有数据本地存储，不上云。**

---

## 7. 关键工程取舍速查表

5 个面试可被追问的工程决策，每个都能展开 3-5 分钟：

| # | 取舍点 | 选择 | 一句话讲法 |
|---|---|---|---|
| 1 | 工作记忆存储 | Redis → SQLite | 单机桌面 vs 工业部署，没必要为了对齐架构图引入额外进程 |
| 2 | LLM Provider 数量 | 单 Provider (DeepSeek) | DeepSeek 单价低到边际收益不明显，KISS 胜出 |
| 3 | Embedding Provider | 必须独立配置 | DeepSeek 不提供 embedding，多模型架构是被迫的工程现实 |
| 4 | LLM-as-Judge | 跨家族（非 DeepSeek） | 自评偏高（self-preference bias），Judge 必须解耦 |
| 5 | 人格设计 | 双层（底色 + 漂移） | 纯漂移可能"长歪"，双层保住基线只让细节漂移 |

---

## 8. v1.0 → v1.1 → v2.0 升级摘要

| 维度 | v1.0 | v1.1 | **v2.0** |
|---|---|---|---|
| 架构模块数 | 4 大 | 4 + 1 双反馈通路 | **4 + 1 + 工具系统 (MCP)** |
| Agent 编排 | 三陪伴 | 三陪伴 | **双族：陪伴族 + 实用族** |
| 人格设计 | 单层 | 双层（底色 + 漂移） | 双层 — 保留 |
| 数据 / 工具 | 本地 | 本地 | 本地 + **MCP 工具调用 + 权限审批流** |
| 端 | Electron 桌面 | Electron 桌面 | **三端：Electron + Web PWA + Mobile 路线图** |
| Backend | 无 | 无 | **Supabase + Vercel（仅服务 Web 端，桌面永不上云）** |
| 数据表 | 5 | 7 | 桌面 11 (+ skills + mcp_servers + permission_grants + tool_call_logs) ；Web 独立 Supabase schema |
| 工程取舍点 | 4 | 5（+ 双层人格） | **6（+ MCP vs FC vs LangChain）** |
| Demo 视频 | 5 场景 | 6 场景 | **3 段：V1 6 场景 + V1.5 4 场景 + V2 4 场景** |
| 周期 | 4 周 | 4 周 | **9 周（V1 4 + V1.5 2 + V2 3）** |
| 灵感来源 | EchoMind | EchoMind + ai-pet | EchoMind + ai-pet + **MCP 生态** |

---

## 9. v2.0 三端部署拓扑

```mermaid
flowchart TB
    subgraph Desktop ["Electron 桌面端 · 完整功能 · 隐私第一"]
        direction TB
        DesktopUI[React + PixiJS v6<br/>+ Live2D Hiyori]
        DesktopMain[Main Process<br/>━━━━━━━━<br/>双族 Agent 编排<br/>MCP host（完整）<br/>权限闸（所有 scope）]
        DesktopDB[(SQLite + ChromaDB<br/>+ OS Keychain)]
        DesktopMCP[(本地 MCP servers<br/>filesystem · git<br/>brave-search · 自建 system)]
        DesktopUI <==> DesktopMain
        DesktopMain <==> DesktopDB
        DesktopMain <==> DesktopMCP
    end

    subgraph Web ["Web / PWA · 在线试玩 · 独立账号"]
        direction TB
        WebUI[React + PixiJS v7 ESM<br/>+ Service Worker]
        VercelAPI[Vercel API Routes<br/>━━━━━━━━<br/>LLM 桥接<br/>BYOK / 平台配额]
        Supabase[(Supabase<br/>━━━━━━━━<br/>Postgres + pgvector<br/>Auth + RLS<br/>Storage + Vault KMS)]
        WebMCP[(裁剪 MCP servers<br/>brave-search · fetch<br/>network scope only)]
        WebUI <==> VercelAPI
        VercelAPI <==> Supabase
        VercelAPI <==> WebMCP
    end

    subgraph Shared ["packages/ · 跨端共享 monorepo"]
        direction TB
        StateMachine[state-machine<br/>XState v5 ✅ W2]
        AgentCore[agent-core<br/>路由 · 编排 · 记忆接口<br/>V1.5]
        UIComp[ui-components<br/>ChatBubble · ConfigDialog<br/>V2]
        MCPShared[mcp-host-shared<br/>schema + bridge<br/>V1.5]
    end

    Desktop -.复用.- Shared
    Web -.复用.- Shared

    User1((桌面用户)):::userClass ==> Desktop
    User2((试玩用户)):::userClass ==> Web
    Mobile((移动用户 · V3)):::userClass -.PWA.- Web

    Desktop x--x|"零数据流通"| Web

    classDef userClass fill:#ffeaa7,stroke:#fdcb6e
```

**关键工程原则**：

- **桌面 ↔ Web 零数据流通**：图里 `x--x` 是断开线。桌面端代码里**不存在**任何 Supabase URL / fetch endpoint，从根上消除上传可能
- **复用而非镜像**：四个共享包同源，但桌面 / Web 各自的 host config / capability 配置完全独立
- **三端责任划分**：桌面 = 长期使用 + 完整工具；Web = 5 分钟体验试玩；Mobile = V3 决策

---

## 10. v2.0 MCP host + 权限闸 拓扑

```mermaid
flowchart TB
    User((用户))
    LLM(["LLM<br/>DeepSeek-V3"])

    subgraph Renderer ["Renderer (React)"]
        ChatUI[Chat UI]
        PermToast[Permission Toast<br/>━━━━━━━━<br/>一次 / 会话 / 永久 / 拒绝]
        Settings[Settings 三 tab<br/>━━━━━━━━<br/>Skills · Tools · Permissions]
    end

    subgraph Main ["Main Process"]
        Orchestrator[双族编排器]
        PermGate[Permission Gate<br/>━━━━━━━━<br/>scope · 白名单<br/>查 grants 表]
        MCPHost[MCP Host<br/>━━━━━━━━<br/>@modelcontextprotocol/sdk-node<br/>stdio + SSE transport<br/>schema cache · bridge to FC]
        ToolLogger[Tool Call Logger]
    end

    subgraph Servers ["MCP servers (子进程 / 远程)"]
        FS[filesystem MCP<br/>npx -y @mcp/server-filesystem]
        Git[git MCP<br/>npx -y mcp-server-git]
        Brave[brave-search MCP<br/>HTTPS SSE]
        SysSrv[自建 system MCP<br/>剪贴板 · 通知]
    end

    subgraph DB ["SQLite"]
        Grants[(permission_grants)]
        Logs[(tool_call_logs)]
        ServerCfg[(mcp_servers)]
    end

    User ==> ChatUI
    ChatUI ==> Orchestrator
    Orchestrator ==>|"实用族 tool_call"| PermGate
    PermGate -.查询.- Grants
    PermGate ==>|"未授权"| PermToast
    PermToast ==>|"用户审批"| PermGate
    PermGate ==>|"批准 + 写永久 grant"| Grants
    PermGate ==>|"放行"| MCPHost
    MCPHost <==> FS
    MCPHost <==> Git
    MCPHost <==> Brave
    MCPHost <==> SysSrv
    MCPHost -.- ServerCfg
    MCPHost ==>|"tool_result"| LLM
    LLM ==>|"summary"| ChatUI
    MCPHost -.写.- ToolLogger
    PermGate -.写.- ToolLogger
    ToolLogger -.- Logs
    Settings -.读/撤销.- Grants
    Settings -.读.- Logs
    Settings -.增删启用.- ServerCfg
```

**关键工程细节**：

- **PermGate 是不可绕过的**：所有 `tool_call` 必经过它；命中 grants 则无感放行（不切状态机），未命中则切 `awaiting-approval` sub-state 弹 toast
- **MCP Host 是 LLM ↔ MCP 的桥**：把 MCP 的 `tools/call` schema 翻译成 DeepSeek function calling 格式，把 `tool_result` 包装为 `role=tool` 消息回喂 LLM
- **审计端到端**：每次 tool_call 不论成功失败都写 `tool_call_logs` 表，可在 Permissions tab 看 / 导出 JSON
- **设置三 tab 闭环**：Skills 启用某个包 → 自动写 `mcp_servers` enabled；Tools tab 显示 server 实时 health；Permissions tab 撤销 grant + 看审计

---

## 11. 关联文档

- [PRD.md](PRD.md) — 产品需求文档（v2.0 完整）
- [STATE-MACHINE.md](STATE-MACHINE.md) — 状态机设计（W2 已实现，V1.5 将加 acting/observing）
- [W1-TECH-PLAN.md](W1-TECH-PLAN.md) — W1 Hiyori demo 实现
- [W2-TECH-PLAN.md](W2-TECH-PLAN.md) — W2 状态机 + DeepSeek 实现
- ASSETS.md (W1 创建) — 第三方资产授权清单
- README.md — 作品集主文档（W4 / W6 / W9 各迭代一版）
