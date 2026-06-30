/** 简洁技术栈介绍 —— 按职责分组的标签墙。 */

interface Group {
  title: string
  items: string[]
}

const GROUPS: Group[] = [
  {
    title: '桌面端',
    items: ['Electron', 'React', 'TypeScript', 'XState v5', 'pixi-live2d-display']
  },
  {
    title: 'AI 对话',
    items: ['DeepSeek', '两层 Prompt', '流式 SSE', '意图路由']
  },
  {
    title: 'Agent 能力',
    items: ['MCP（Model Context Protocol）', '权限闸', 'Skills 框架', '性格演化引擎']
  },
  {
    title: '数据 & 隐私',
    items: ['SQLite（better-sqlite3）', '全本地存储']
  },
  {
    title: '官网',
    items: ['Next.js', 'Tailwind CSS', 'Vercel']
  },
  {
    title: '工程',
    items: ['pnpm monorepo', 'Vitest', '跨端复用 agent-core']
  }
]

export default function TechStack(): React.ReactElement {
  return (
    <section id="tech" className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mb-4 inline-block rounded-full bg-peach-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-peach-600">
            技术栈
          </span>
          <h2 className="text-2xl font-bold text-ink sm:text-3xl">用什么做的</h2>
          <p className="mx-auto mt-4 text-sm leading-relaxed text-ink-soft">
            桌面端 + 跨端复用的逻辑包 + 一个轻量官网，全部 TypeScript。
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="rounded-3xl bg-white p-6 ring-1 ring-peach-100">
              <h3 className="text-sm font-bold text-peach-600">{g.title}</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {g.items.map((it) => (
                  <span
                    key={it}
                    className="rounded-lg bg-peach-50 px-2.5 py-1 text-xs font-medium text-ink"
                  >
                    {it}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
