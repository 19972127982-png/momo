'use client'

/**
 * 性格自适应 —— 网站核心卖点。
 * 数据/机制对齐 packages/agent-core：
 *   - 三维向量 energy / attachment / sensitivity
 *   - 每轮对话后一个"微小"的 delta（单轮上限极小）累积成长期漂移
 *   - 成长阶段：初识 / 熟悉 / 亲密 / 挚友（按互动总数）
 *
 * 三维滑块带「滚动进入视口」的轻微入场动画：标记点从中点滑到当前位置 + 渐显。
 */

import { useEffect, useRef, useState } from 'react'

interface Dimension {
  label: string
  left: string
  right: string
  /** 0~100：示意"此刻"的位置，纯展示用 */
  pos: number
}

const DIMENSIONS: Dimension[] = [
  { label: '活力', left: '安静内敛', right: '活泼好动', pos: 68 },
  { label: '依恋', left: '独立', right: '粘人', pos: 74 },
  { label: '敏感度', left: '钝感踏实', right: '细腻共情', pos: 62 }
]

const STAGES = [
  { name: '初识', note: '好奇拘谨' },
  { name: '熟悉', note: '自在放松' },
  { name: '亲密', note: '撒娇任性' },
  { name: '挚友', note: '最懂你' }
]

function DimensionBar({
  d,
  active,
  delay
}: {
  d: Dimension
  active: boolean
  delay: number
}): React.ReactElement {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-ink-soft">
        <span>{d.left}</span>
        <span className="rounded-full bg-peach-50 px-2.5 py-0.5 font-semibold text-peach-600">
          {d.label}
        </span>
        <span>{d.right}</span>
      </div>
      <div className="relative h-2 rounded-full bg-peach-100">
        {/* 从中点渐变到标记点的填充轨迹 */}
        <div
          className="absolute top-0 h-full rounded-full bg-peach-300/70 transition-all duration-[900ms] ease-out"
          style={{
            left: '50%',
            width: active ? `${Math.abs(d.pos - 50)}%` : '0%',
            transform: d.pos < 50 ? 'translateX(-100%)' : 'none',
            transitionDelay: `${delay}ms`
          }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-peach-500 shadow-md transition-all duration-[900ms] ease-out"
          style={{
            left: active ? `${d.pos}%` : '50%',
            opacity: active ? 1 : 0,
            transitionDelay: `${delay}ms`
          }}
        />
      </div>
    </div>
  )
}

export default function PersonalityShowcase(): React.ReactElement {
  const barsRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = barsRef.current
    if (!el) return
    // 已支持的浏览器用 IntersectionObserver 做滚动进场；否则直接显示
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section id="personality" className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mb-4 inline-block rounded-full bg-peach-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-peach-600">
            核心特性 · 性格自适应
          </span>
          <h2 className="text-2xl font-bold text-ink sm:text-3xl">
            她会慢慢长成「你的」样子
          </h2>
          <p className="mx-auto mt-4 text-sm leading-relaxed text-ink-soft sm:text-base">
            EchoPet 没有写死的人设。它的性格由一个三维向量描述，
            <span className="text-ink">每一次相处都会留下一点痕迹</span>
            ——日积月累，你会养出一只独一无二、只属于你的 EchoPet。
          </p>
        </div>

        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-2">
          {/* 左：三维向量 */}
          <div className="rounded-3xl bg-white p-7 ring-1 ring-peach-100">
            <h3 className="text-base font-bold text-ink">性格的三个维度</h3>
            <p className="mt-1.5 text-xs text-ink-soft">
              活力、依恋、敏感度——共同决定她此刻怎么和你说话。
            </p>
            <div ref={barsRef} className="mt-7 space-y-6">
              {DIMENSIONS.map((d, i) => (
                <DimensionBar key={d.label} d={d} active={inView} delay={i * 140} />
              ))}
            </div>
          </div>

          {/* 右：演化机制 */}
          <div className="flex flex-col justify-center rounded-3xl bg-gradient-to-br from-peach-500 to-peach-400 p-7 text-white">
            <h3 className="text-base font-bold">每轮对话，悄悄微调</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/90">
              每聊完一句，一个轻量分析器会读一遍这次互动，给三个维度一个
              <span className="font-semibold">极其微小</span>
              的调整：你热情玩闹，她会更活泼；你常找她，她会更依恋你；
              你流露情绪、被她细腻接住，她会更敏感共情。
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/90">
              单次变化小到几乎察觉不到，但长期累积，
              <span className="font-semibold">性格会发生肉眼可见的漂移</span>
              ——这正是「养成感」的来源。
            </p>
          </div>
        </div>

        {/* 成长阶段 */}
        <div className="mt-10 rounded-3xl bg-white p-7 ring-1 ring-peach-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-bold text-ink">相处越久，关系越近</h3>
            <span className="text-xs text-ink-soft">随互动次数自然推进</span>
          </div>
          <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {STAGES.map((s, i) => (
              <div key={s.name} className="relative">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-peach-500 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="font-bold text-ink">{s.name}</span>
                </div>
                <p className="mt-2 pl-9 text-xs text-ink-soft">{s.note}</p>
                {i < STAGES.length - 1 && (
                  <span className="absolute right-1 top-3.5 hidden text-peach-300 sm:block">
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-ink-soft">
            她还会记得你聊过的事、慢慢拼出对你的了解，并把这些一起揉进每一次回应里。
            所有成长都只发生在你自己的电脑上。
          </p>
        </div>
      </div>
    </section>
  )
}
