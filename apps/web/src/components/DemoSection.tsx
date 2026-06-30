'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Demo 区：按功能分模块展示录屏。
 *
 * 加载策略：人物（Live2D）就绪后立即预加载全部视频（见 useEagerAfterPet），不再等进视口。
 *
 * 播放策略（关键）：由父组件统一协调"哪些卡片该播"。
 * - 移动端：同一时刻只播「最可见」的 1 个，其余暂停显示首帧。
 *   原因：移动端浏览器（尤其 iOS Safari）对同时解码的视频数有硬限制，
 *   多个一起播会卡顿、且部分会停在首帧不动。
 * - 桌面端：可见比例≥0.4 的都播（同时解码压力可接受）。
 *
 * 「创建提醒」内部由两段录屏组成（先设置、后到点通知），对外与单段卡片一致：
 * 自动连播 1→2 再循环，不暴露分段。
 */

interface DemoItem {
  src?: string
  srcs?: string[]
  title: string
  desc: string
}

const DEMOS: DemoItem[] = [
  {
    src: '/demo/companion-memory.mp4',
    title: '情感陪伴 & 记忆',
    desc: '先听你说、再轻轻接住情绪，而不是冷冰冰地一问一答。还会记得你提过的事，聊得越久越懂你。'
  },
  {
    src: '/demo/desktop-read.mp4',
    title: '读取桌面文件',
    desc: '让 EchoPet 看看桌面上有什么、读出某个文件里写了啥——自然语言说一句就行。'
  },
  {
    src: '/demo/file-write.mp4',
    title: '整理 & 写入文件',
    desc: '新建、写入、归整文件都能交给 ta。每一次「动手」前都会先弹窗征得你同意。'
  },
  {
    src: '/demo/image-ocr.mp4',
    title: '图片识别',
    desc: '把一张图丢给 ta，自动识别出图里的文字（本地 OCR），再帮你接着处理。'
  },
  {
    srcs: ['/demo/reminder-1.mp4', '/demo/reminder-2.mp4'],
    title: '创建提醒',
    desc: '说一句「提醒我…」，EchoPet 帮你记下；到点用系统通知准时叫你，不怕错过要紧事。'
  },
  {
    src: '/demo/settings.mp4',
    title: '个性化配置',
    desc: '给 ta 起名字、设定怎么称呼你、开关技能包、逐项管理权限——都在设置面板里。'
  }
]

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const apply = (): void => setMobile(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return mobile
}

/**
 * 是否可以开始预加载视频：人物（Live2D）就绪后才开始，避免和人物抢带宽。
 * 监听 PetWidget 广播的 'echopet:pet-ready'；若已就绪则立即开始；并带安全兜底。
 */
function useEagerAfterPet(): boolean {
  const [eager, setEager] = useState(false)
  useEffect(() => {
    if ((window as unknown as { __echopetPetReady?: boolean }).__echopetPetReady) {
      setEager(true)
      return
    }
    const on = (): void => setEager(true)
    window.addEventListener('echopet:pet-ready', on)
    const t = window.setTimeout(() => setEager(true), 8000)
    return () => {
      window.removeEventListener('echopet:pet-ready', on)
      window.clearTimeout(t)
    }
  }, [])
  return eager
}

/** /demo/foo.mp4 → /demo/posters/foo.jpg（首帧占位，秒显） */
function posterFor(src: string): string {
  const file = src.split('/').pop() ?? ''
  return `/demo/posters/${file.replace(/\.mp4$/, '.jpg')}`
}

/** 缓冲转圈 */
function Spinner(): React.ReactElement {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-peach-200 border-t-peach-500" />
    </div>
  )
}

function AutoVideo({
  src,
  eager,
  play
}: {
  src: string
  eager: boolean
  play: boolean
}): React.ReactElement {
  const ref = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const loadStarted = useRef(false)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (eager && !loadStarted.current) {
      loadStarted.current = true
      v.preload = 'auto'
      try {
        v.load()
      } catch {
        /* ignore */
      }
    }
    if (play && ready) {
      v.play().catch(() => {})
    } else if (!play) {
      v.pause()
    }
  }, [play, ready, eager])

  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        src={src}
        poster={posterFor(src)}
        muted
        loop
        playsInline
        preload="none"
        onCanPlay={() => setReady(true)}
        className="h-full w-full object-contain"
      />
      {play && !ready && <Spinner />}
    </div>
  )
}

/** 多段连播：顺序播放并整体循环 */
function SeqVideo({
  srcs,
  eager,
  play
}: {
  srcs: string[]
  eager: boolean
  play: boolean
}): React.ReactElement {
  const ref = useRef<HTMLVideoElement>(null)
  const [idx, setIdx] = useState(0)
  const [ready, setReady] = useState(false)
  const loadedIdx = useRef(-1)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    // 换源（含初次/切段）：必须 load() 才能真正切到新 src
    if (eager && loadedIdx.current !== idx) {
      loadedIdx.current = idx
      v.preload = 'auto'
      try {
        v.load()
      } catch {
        /* ignore */
      }
      return
    }
    if (play && ready) {
      v.play().catch(() => {})
    } else if (!play) {
      v.pause()
    }
  }, [play, ready, idx, eager])

  function onEnded(): void {
    setReady(false)
    setIdx((i) => (i + 1) % srcs.length)
  }

  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        src={srcs[idx]}
        poster={posterFor(srcs[0])}
        muted
        playsInline
        preload="none"
        onCanPlay={() => setReady(true)}
        onEnded={onEnded}
        className="h-full w-full object-contain"
      />
      {play && !ready && <Spinner />}
    </div>
  )
}

function VideoCard({
  item,
  eager,
  play,
  onRatio
}: {
  item: DemoItem
  eager: boolean
  play: boolean
  onRatio: (key: string, ratio: number) => void
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => onRatio(item.title, entry.intersectionRatio),
      { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      onRatio(item.title, 0)
    }
  }, [item.title, onRatio])

  return (
    <figure className="overflow-hidden rounded-3xl bg-white ring-1 ring-peach-100">
      <div ref={ref} className="grid aspect-square place-items-center bg-peach-50">
        {item.srcs ? (
          <SeqVideo srcs={item.srcs} eager={eager} play={play} />
        ) : (
          <AutoVideo src={item.src!} eager={eager} play={play} />
        )}
      </div>
      <figcaption className="px-5 py-4">
        <h3 className="text-base font-bold text-ink">{item.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{item.desc}</p>
      </figcaption>
    </figure>
  )
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

export default function DemoSection(): React.ReactElement {
  const eager = useEagerAfterPet()
  const isMobile = useIsMobile()
  const ratios = useRef<Map<string, number>>(new Map())
  const [playKeys, setPlayKeys] = useState<string[]>([])

  const recompute = useCallback((): void => {
    const entries = [...ratios.current.entries()]
    let next: string[]
    if (isMobile) {
      // 只播最可见的一个（且需达到一定可见度）
      let best: string | null = null
      let bestR = 0.35
      for (const [k, r] of entries) {
        if (r >= bestR) {
          best = k
          bestR = r
        }
      }
      next = best ? [best] : []
    } else {
      next = entries.filter(([, r]) => r >= 0.4).map(([k]) => k)
    }
    setPlayKeys((prev) => (sameSet(prev, next) ? prev : next))
  }, [isMobile])

  // 移动/桌面切换时重算
  useEffect(() => {
    recompute()
  }, [recompute])

  const onRatio = useCallback(
    (key: string, ratio: number): void => {
      ratios.current.set(key, ratio)
      recompute()
    },
    [recompute]
  )

  return (
    <section id="demo" className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mb-4 inline-block rounded-full bg-peach-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-peach-600">
            实机演示
          </span>
          <h2 className="text-2xl font-bold text-ink sm:text-3xl">看看她平时的样子</h2>
          <p className="mx-auto mt-4 text-sm leading-relaxed text-ink-soft">
            从一句问候，到帮你把桌面收拾干净——每一项「动手」都先征得你同意。
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {DEMOS.map((d) => (
            <VideoCard
              key={d.title}
              item={d}
              eager={eager}
              play={playKeys.includes(d.title)}
              onRatio={onRatio}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
