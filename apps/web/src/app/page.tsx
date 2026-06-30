import PetWidget from '@/components/PetWidget'
import PersonalityShowcase from '@/components/PersonalityShowcase'
import ArchitectureDiagram from '@/components/ArchitectureDiagram'
import TechStack from '@/components/TechStack'
import DemoSection from '@/components/DemoSection'
import { SITE } from '@/lib/site'

const FEATURES = [
  {
    icon: '💬',
    title: '陪你聊天',
    desc: '不是冷冰冰的一问一答。她会先听你说，再轻轻接住你的情绪。'
  },
  {
    icon: '🌱',
    title: '越处越懂你',
    desc: '记得你提过的事，性格也会随着相处慢慢变化，越来越像"你的"那一只。'
  },
  {
    icon: '🧹',
    title: '帮你动手',
    desc: '整理桌面文件、设个提醒、复制一段话——动手前都会先问你一句。'
  },
  {
    icon: '🔒',
    title: '都在你电脑里',
    desc: '聊天和密钥只存在本机，不上传云端。安静地待在桌面角落陪着你。'
  }
] as const

export default function Home(): React.ReactElement {
  return (
    <main className="relative overflow-hidden">
      {/* 顶部渐变：提升到 main 顶层，覆盖移动端置顶的人物区域，避免留白 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] bg-gradient-to-b from-peach-100 via-peach-50 to-transparent"
      />

      {/* 桌宠：移动端在文档流顶部（随滚动），桌面端右侧悬浮固定 */}
      <PetWidget />

      {/* ---------------- Hero ---------------- */}
      <section className="relative px-6 pb-20 pt-24 sm:pt-32">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <span className="animate-fade-up mb-5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold tracking-wide text-peach-600 shadow-sm ring-1 ring-peach-100">
            桌面陪伴 · 会聊天也会动手
          </span>
          <h1 className="animate-fade-up text-4xl font-extrabold leading-tight text-ink sm:text-6xl">
            {SITE.petName}，住在你桌面的
            <br className="hidden sm:block" />
            <span className="text-peach-500"> Agent</span>
          </h1>
          <p className="animate-fade-up mt-6 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
            会陪你聊天，记得你说过的话，还能帮你整理文件、设个提醒——
            <br className="hidden sm:block" />
            动手前，都会先问你一句。
          </p>
          <div className="animate-fade-up mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href={SITE.downloadMac}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-peach-500 px-7 py-3 text-base font-semibold text-white shadow-lg shadow-peach-300/40 transition hover:bg-peach-600"
            >
              免费下载
            </a>
            <a
              href={SITE.github}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-7 py-3 text-base font-semibold text-ink ring-1 ring-peach-200 transition hover:bg-peach-50"
            >
              在 GitHub 上看看
            </a>
          </div>
          <p className="animate-fade-up mt-4 text-xs text-ink-soft/80">
            目前支持 macOS（Apple 芯片）· 需自备 DeepSeek 密钥 · 右下角可以先和 EchoPet 聊两句
          </p>
        </div>
      </section>

      {/* ---------------- 能做什么 ---------------- */}
      <section id="features" className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">
            她能陪你做点什么
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-soft">
            一只有温度的桌宠，也是一个会帮你搭把手的小助手。
          </p>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-3xl bg-white p-6 ring-1 ring-peach-100 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-peach-300/20"
              >
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-peach-50 text-2xl">
                  {f.icon}
                </div>
                <h3 className="mt-4 text-lg font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 性格自适应（核心卖点） ---------------- */}
      <PersonalityShowcase />

      {/* ---------------- Demo（实机演示，放在架构之前） ---------------- */}
      <DemoSection />

      {/* ---------------- 架构图 ---------------- */}
      <ArchitectureDiagram />

      {/* ---------------- 技术栈 ---------------- */}
      <TechStack />

      {/* ---------------- 下载 ---------------- */}
      <section id="download" className="px-6 py-20">
        <div className="mx-auto max-w-2xl rounded-[2rem] bg-gradient-to-br from-peach-500 to-peach-400 px-8 py-12 text-center text-white shadow-2xl shadow-peach-300/40">
          <h2 className="text-2xl font-bold sm:text-3xl">把 EchoPet 带回家</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/90">
            装好后，她就会安静地待在你的桌面角落。需要时喊一声，不需要时也不打扰。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={SITE.downloadMac}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-7 py-3 text-base font-semibold text-peach-600 shadow-md transition hover:bg-peach-50"
            >
              下载 macOS 版
            </a>
            <a
              href={SITE.github}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white/15 px-7 py-3 text-base font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/25"
            >
              查看源码
            </a>
          </div>
          <p className="mx-auto mt-6 max-w-md text-xs leading-relaxed text-white/80">
            首次打开请右键点图标选「打开」放行一次（应用未做付费签名）。
            需要一个 DeepSeek 密钥才能聊天，密钥只存在你自己电脑上。
          </p>
        </div>
      </section>

      {/* ---------------- 页脚 ---------------- */}
      <footer className="border-t border-peach-100 px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-sm text-ink-soft sm:flex-row">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-peach-300 to-peach-500 text-base">
              🍑
            </span>
            {SITE.name}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="#features" className="transition hover:text-peach-600">
              功能
            </a>
            <a href="#personality" className="transition hover:text-peach-600">
              性格
            </a>
            <a href="#architecture" className="transition hover:text-peach-600">
              架构
            </a>
            <a href="#download" className="transition hover:text-peach-600">
              下载
            </a>
            <a
              href={SITE.github}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-peach-600"
            >
              GitHub
            </a>
          </div>
          <p className="text-xs text-ink-soft/70">为想要一点陪伴的人而做</p>
        </div>
      </footer>
    </main>
  )
}
