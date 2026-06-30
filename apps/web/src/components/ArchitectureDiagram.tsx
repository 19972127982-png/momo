/**
 * 项目架构图（分层）——尽量完整反映真实能力：
 *   入口(桌面/官网) → agent-core 大脑(对话/性格/记忆/工作族/安全) → 能力层(主进程)
 *   → 数据层(SQLite 本地) → 外部依赖
 * 并标注：同一套 agent-core 复用到官网右下角 EchoPet（仅陪伴）。
 */

const SURFACES = [
  {
    tag: '桌面 App',
    sub: 'Electron · Renderer（React + XState v5 状态机）',
    chips: ['Live2D 桌宠窗口', '聊天 / 拖拽文件总结', '操作审批弹窗', '透明置顶 · 可拖动']
  },
  {
    tag: '官网',
    sub: 'Next.js · 你正在看的这一页',
    chips: ['右下角 EchoPet（仅陪伴）', '/api/chat 服务端代理', '工具意图引导下载']
  }
] as const

const BRAIN_GROUPS = [
  {
    name: '对话与意图',
    chips: ['意图路由（关键词 + LLM 混合 · 两级）', 'CompanionAgent 陪伴', '两层 Prompt 拼装']
  },
  {
    name: '性格与成长',
    chips: ['性格演化引擎（三维向量）', '成长阶段（初识 → 挚友）', '性格 → 语气映射']
  },
  {
    name: '记忆',
    chips: ['情景记忆（摘要 + 关键词召回）', '用户画像提取']
  },
  {
    name: '工作族 Agent',
    chips: ['FileAgent（文件增删改查）', 'SystemAgent（剪贴板 / 通知）', 'Function Calling']
  },
  {
    name: '安全边界',
    chips: [
      '权限闸（read / write / exec / network）',
      '授权粒度（一次 / 本次会话 / 永久）',
      'Skills 可装卸能力包'
    ]
  }
] as const

const LOWER_LAYERS = [
  {
    tag: '能力层',
    title: '主进程 · Main',
    chips: [
      'MCP Host：stdio（filesystem）',
      '进程内 local（剪贴板 / 系统通知）',
      '文件总结（拖拽 + OCR）',
      '权限授权流（IPC）'
    ]
  },
  {
    tag: '数据层',
    title: '本地持久化 · SQLite',
    chips: [
      '性格 & 演化轨迹',
      '情景记忆',
      '用户画像',
      '权限授权',
      '工具调用日志',
      'Skills 状态',
      'API Key（本地文件）',
      '设置'
    ]
  },
  {
    tag: '外部',
    title: '依赖',
    chips: ['DeepSeek API（流式 SSE）', '本地文件系统', '系统剪贴板 / 通知']
  }
] as const

function Arrow(): React.ReactElement {
  return (
    <div className="flex justify-center py-1.5 text-peach-300" aria-hidden>
      ↓
    </div>
  )
}

export default function ArchitectureDiagram(): React.ReactElement {
  return (
    <section id="architecture" className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mb-4 inline-block rounded-full bg-peach-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-peach-600">
            它是怎么搭起来的
          </span>
          <h2 className="text-2xl font-bold text-ink sm:text-3xl">项目架构</h2>
          <p className="mx-auto mt-4 text-sm leading-relaxed text-ink-soft">
            界面只管表现，「大脑」沉淀成可跨端复用的纯逻辑包，动手能力收在主进程、由权限闸把关，
            数据全部留在本地。
          </p>
        </div>

        <div className="mt-12">
          {/* 入口层 */}
          <div className="grid gap-4 sm:grid-cols-2">
            {SURFACES.map((s) => (
              <div key={s.tag} className="rounded-2xl bg-peach-50 p-5 ring-1 ring-peach-100">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-peach-600">
                    {s.tag}
                  </span>
                  <span className="text-xs text-ink-soft">{s.sub}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.chips.map((c) => (
                    <span
                      key={c}
                      className="rounded-lg bg-white px-2.5 py-1 text-xs text-ink ring-1 ring-peach-100"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <Arrow />

          {/* 大脑层（核心）—— 与其余层统一配色 */}
          <div className="rounded-3xl bg-peach-50 p-6 ring-1 ring-peach-100">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-peach-600">
                大脑层
              </span>
              <span className="text-sm font-semibold text-ink">
                agent-core · 跨端复用的纯逻辑
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {BRAIN_GROUPS.map((g) => (
                <div key={g.name} className="rounded-2xl bg-white p-4 ring-1 ring-peach-100">
                  <h4 className="text-xs font-bold text-peach-600">{g.name}</h4>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {g.chips.map((c) => (
                      <span
                        key={c}
                        className="rounded-md bg-peach-50 px-2 py-0.5 text-[11px] leading-relaxed text-ink"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 能力层 / 数据层 / 外部 */}
          {LOWER_LAYERS.map((layer) => (
            <div key={layer.tag}>
              <Arrow />
              <div className="rounded-2xl bg-peach-50 px-5 py-4 ring-1 ring-peach-100">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-peach-600">
                    {layer.tag}
                  </span>
                  <span className="text-sm font-semibold text-ink">{layer.title}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {layer.chips.map((c) => (
                    <span
                      key={c}
                      className="rounded-lg bg-white px-2.5 py-1 text-xs text-ink-soft ring-1 ring-peach-100"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-dashed border-peach-200 bg-peach-50/50 px-5 py-4 text-center text-xs leading-relaxed text-ink-soft">
          <span className="font-semibold text-peach-600">同源复用：</span>
          你正在右下角聊天的网页版 EchoPet，用的就是同一套 agent-core——
          只保留「陪伴」能力，动手类需求会被识别并引导你下载桌面版。
        </div>
      </div>
    </section>
  )
}
