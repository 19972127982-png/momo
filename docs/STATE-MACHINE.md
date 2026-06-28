# EchoPet · 角色行为状态机设计（W2 蓝图）

> 状态：W1 阶段规划文档（未实现）· 适用：W2 起的对话闭环
>
> 目标：把「用户操作 + Agent 内部状态」**翻译成** Hiyori 的 motion / 参数动作，**全程不由人手点按钮触发**。
>
> **技术选型（已锁定）：**
> - 状态机库：**XState v5**（可视化、可单测、作品集加分）
> - LipSync：**不做**（V1 范围外，speaking 状态只播 Tap motion，不驱动嘴部参数）
> - 输入框：**默认隐藏，点击角色才弹出**（在角色脚下淡入）

---

## 1. 设计目标

W1 demo 阶段，6 个状态按钮直接驱动 motion——这是调试入口，**不会进入 V1 正式版**。

V1 阶段，角色动作完全由状态机驱动，触发链路：

```
用户行为 / Agent 事件 → PetEvent → FSM 状态转移 → 派发 motion / LipSync 指令 → Live2DModel
```

要解决的问题：
1. **状态语义清晰** —— 每个状态对应一个清晰的「桌宠正在干嘛」（待机/听/想/说/抱歉）
2. **资源 1:1 映射** —— 状态到 motion 的映射严格 1:1，资源缺哪个动作就明确写出来
3. **与 LLM 解耦** —— FSM 只接受抽象 PetEvent，LLM/Agent 层只发事件，不需要知道 Hiyori 有几个 motion
4. **可单测** —— 纯函数 reducer，UI 完全没参与状态计算

---

## 2. 状态定义（PetState）

按「桌宠正在做什么」分层，**6 个状态**：

| State | 含义 | 触发场景 | Hiyori motion 映射 |
|---|---|---|---|
| `idle` | 默认待机 | App 启动 / 长时间无交互 | `Idle`（随机 m01/m02/m05）循环 |
| `listening` | 在听用户说 | 用户点击角色后输入框弹出，输入框聚焦 / 正在打字 | `FlickUp` 单次（抬头看用户），之后回 `Idle` |
| `thinking` | 正在想 | 用户已发送，等 LLM 首字节 | `Idle` 慢速循环（Hiyori 没有专门思考动作） |
| `speaking` | 输出中 | LLM 流式返回 chunk 中 | `Tap` 单次（开口），motion 不打断 |
| `done` | 刚说完 | LLM 流结束 | 无新 motion，自然 fallback 到 `Idle` |
| `apologetic` | 出错/挫败 | 网络错误 / API 失败 / 用户表达不满 | `FlickDown` 单次（低头） |

> 已剔除：
> - `startled` / `excited` / `shy` —— 这些是「情绪」不是「行为状态」。情绪由 **personality 模块**单独驱动（W3），通过修改当前 motion 的 *播放参数*（速度、混合权重）而不是切换 state，避免状态爆炸。
> - **LipSync** —— V1 范围外。`speaking` 只播 `Tap` motion，嘴部参数完全交给 Hiyori 自带的 motion 动画。

---

## 3. 事件定义（PetEvent）

事件按来源分三类：

### 3.1 用户事件（用户行为产生）

| Event | 数据 | 说明 |
|---|---|---|
| `ui/pet-click` | — | 用户点击角色（区分于拖动），唤起输入框 |
| `ui/input-blur` | — | 输入框失焦 / Esc 取消 |
| `user/send` | `{ text: string }` | 用户回车发送消息 |

### 3.2 Agent 事件（系统内部产生）

| Event | 数据 | 说明 |
|---|---|---|
| `agent/thinking/start` | `{ requestId: string }` | LLM 调用发出 |
| `agent/thinking/end` | `{ requestId: string }` | LLM 首个 token 到达 |
| `agent/stream/chunk` | `{ text: string }` | 流式输出一段文本 |
| `agent/stream/end` | `{ requestId: string }` | 流结束 |
| `agent/error` | `{ error: Error }` | LLM / 网络出错 |

### 3.3 系统事件

| Event | 数据 | 说明 |
|---|---|---|
| `tick/idle` | — | 状态停留超时（如 `done` 停 1.5s 后回 `idle`） |

---

## 4. 状态转移矩阵

```
                ┌──────────────────────────────────────────────────┐
                ↓                                                  │
            ┌──────┐  ui/pet-click       ┌───────────┐            │
            │ idle ├────────────────────→│ listening │            │
            └──────┘                     └─────┬─────┘            │
                                               │                  │
                                user/send  ┌───┴────────────┐     │
                                           │                │     │
                                           ↓                ↓     │
                                  ┌──────────┐ agent/    ┌──────┐ │
                                  │ thinking │ thinking/ │ idle │ │
                                  └────┬─────┘   end     └──────┘ │
                                       │           ↓              │
                                       │      ┌──────────┐        │
                                       │      │ speaking │        │
                                       │      └─────┬────┘        │
                          agent/error  │            │             │
                                       ↓     agent/stream/end     │
                                  ┌────────────┐    ↓             │
                                  │ apologetic │ ┌──────┐         │
                                  └─────┬──────┘ │ done ├─tick/idle
                                        │tick/idle└──────┘        │
                                        └─────────────────────────┘
                          ↑
                      agent/error 也能从 speaking 跳过来
```

XState 5 machine 定义骨架：

```ts
import { setup } from 'xstate'

export const petMachine = setup({
  types: {
    context: {} as { lastError: string | null },
    events: {} as
      | { type: 'ui.pet-click' }
      | { type: 'ui.input-blur' }
      | { type: 'user.send'; text: string }
      | { type: 'agent.thinking-start' }
      | { type: 'agent.thinking-end' }
      | { type: 'agent.stream-chunk'; text: string }
      | { type: 'agent.stream-end' }
      | { type: 'agent.error'; error: string }
  },
  actions: {
    playMotion: (_ctx, _ev, { params }: { params: { group: string } }) => {
      // 由 React 层订阅 actor 时注入实际 model.motion() 调用
    },
    showInputBox: () => {},
    hideInputBox: () => {}
  }
}).createMachine({
  id: 'pet',
  initial: 'idle',
  context: { lastError: null },
  states: {
    idle: {
      on: {
        'ui.pet-click': 'listening',
        'user.send': 'thinking'
      }
    },
    listening: {
      entry: [
        { type: 'playMotion', params: { group: 'FlickUp' } },
        { type: 'showInputBox' }
      ],
      exit: 'hideInputBox',
      on: {
        'user.send': 'thinking',
        'ui.input-blur': 'idle'
      }
    },
    thinking: {
      on: {
        'agent.thinking-end': 'speaking',
        'agent.error': 'apologetic'
      }
    },
    speaking: {
      entry: { type: 'playMotion', params: { group: 'Tap' } },
      on: {
        'agent.stream-end': 'done',
        'agent.error': 'apologetic'
        // stream-chunk 不切状态（V1 不做 LipSync，也不需要副作用）
      }
    },
    done: {
      after: { 1500: 'idle' },
      on: { 'user.send': 'thinking' }
    },
    apologetic: {
      entry: { type: 'playMotion', params: { group: 'FlickDown' } },
      after: { 3000: 'idle' }
    }
  }
})
```

XState 优势：
1. `after`(timeout) / `entry`/`exit` actions 内置，不需要手写 ticker
2. Stately Studio 可视化 export → 直接贴到作品集 / README
3. `@xstate/react` 的 `useMachine` 钩子和 React 集成成熟
4. `@xstate/test` 可以生成测试用例覆盖所有转移路径

---

## 5. 副作用（状态进入时派发的 motion）

XState 把副作用打包成 `entry` / `exit` action，机器定义里直接声明（见上方 machine 骨架）：

| State | entry action | exit action |
|---|---|---|
| `idle` | — | — |
| `listening` | `playMotion(FlickUp)` + `showInputBox` | `hideInputBox` |
| `thinking` | — | — |
| `speaking` | `playMotion(Tap)` | — |
| `done` | — | — |
| `apologetic` | `playMotion(FlickDown)` | — |

React 集成（`@xstate/react`）：

```tsx
const PetActorContext = createActorContext(petMachine)

function PetCanvas() {
  const actorRef = PetActorContext.useActorRef()
  const petControllerRef = useRef<PetController | null>(null)

  // 拦截 playMotion action 注入实际的 motion 调用
  useEffect(() => {
    const sub = actorRef.subscribe((snapshot) => {
      const action = snapshot.context.lastAction
      if (action?.type === 'playMotion') {
        petControllerRef.current?.playMotion(action.params.group)
      }
    })
    return () => sub.unsubscribe()
  }, [actorRef])
  // ...
}
```

---

## 6. 自动 tick / 超时策略

XState 5 内置 `after` 转移，无需手写 ticker：

```ts
done:        { after: { 1500: 'idle' } }
apologetic:  { after: { 3000: 'idle' } }
```

进入 state 时自动 arm 定时器，离开时自动 cancel。

---

## 7. 文件 / 模块拆分（W2 实现）

```
packages/
  state-machine/                 # 纯 TS（XState），无 UI / Electron 依赖，可单测
    src/
      machine.ts                 # petMachine（XState setup + createMachine）
      types.ts                   # PetState / PetEvent 类型导出
      index.ts
    test/
      machine.test.ts            # 单测：核心转移路径 + @xstate/test 路径覆盖

apps/desktop/src/renderer/src/
  state/
    PetActorContext.tsx          # createActorContext(petMachine) + Provider
    useLive2DBridge.ts           # 订阅 actor 状态 → 调 model.motion
  components/
    ChatInput.tsx                # 输入框，dispatch ui.input-blur + user.send
    ChatBubble.tsx               # 显示 agent stream（基于 actor snapshot）
```

---

## 8. 验收（W2 完成标准）

1. ✅ **点击角色**（区分拖动）→ 输入框在角色脚下淡入 + 角色 FlickUp（抬头看）
2. ✅ 输入框失焦 / Esc → 输入框淡出 + 状态回 `idle`
3. ✅ 用户回车发送 → 角色切到「思考」（Idle 慢节奏）
4. ✅ LLM 首字节到达 → 角色 Tap 一次（开口）+ 进入 `speaking`
5. ✅ 输出完毕 1.5s 后 → 自动回 `idle`
6. ✅ API 出错 → FlickDown 一次，3s 后回 `idle`
7. ✅ 整个流程**不需要手点任何调试按钮**（DebugStateBar 改 dev-only）
8. ✅ `packages/state-machine` XState machine + 转移路径单测覆盖
9. ✅ Stately Studio 可视化截图加进 README / 作品集

---

## 9. 与 v1.1 PRD 的对齐

PRD §3.1 列了「5 种基础表情、3 种动作（站立/伸懒腰/睡觉）」—— 这是 **资源理想态**，Hiyori PRO 实际只有 7 个 motion group，没有「伸懒腰/睡觉」。

V1 范围对齐方案：
- 「站立」→ `Idle`
- 「伸懒腰」→ `FlickUp`（抬手抬头，最近似的）
- 「睡觉」→ `Idle` 的低速版本（用 motion 参数 `playbackRate < 1`）
- 「5 种表情」→ V1 退化为 **6 个行为状态**，PRD §3.1 在 v1.2 时同步更新

> 这是 Hiyori 免费资源的限制。如果 V2 切到自制 / 商用 Live2D 资源，可以补 motion，但 V1 范围以现有资源为准。
