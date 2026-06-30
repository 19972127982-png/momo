'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Demo 区：按功能分模块展示录屏。
 *
 * 性能策略（避免一进页面就并发下载 ~48MB + 同时解码导致卡顿、并挤占 Live2D 的 GPU/带宽）：
 * - preload="none"：不进视口不下载
 * - IntersectionObserver：仅当卡片进入视口才 play()，离开即 pause()
 * - 静音循环，观感等同「自动循环播放」
 *
 * 「创建提醒」内部由两段录屏组成（先设置、后到点通知），对外与单段卡片一致：
 * 进视口后自动连播 1→2 再循环，不暴露分段。
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

/** 监听某元素是否进入视口（带预加载余量） */
function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 仅当卡片真正可见约一半时才播：避免快速滚动时多个视频同时解码（移动端尤其卡）
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.intersectionRatio >= 0.4),
      { threshold: [0, 0.4, 0.6] }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, inView]
}

/** /demo/foo.mp4 → /demo/posters/foo.jpg（首帧占位，秒显） */
function posterFor(src: string): string {
  const file = src.split('/').pop() ?? ''
  return `/demo/posters/${file.replace(/\.mp4$/, '.jpg')}`
}

function AutoVideo({ src }: { src: string }): React.ReactElement {
  const [ref, inView] = useInView<HTMLVideoElement>()

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (inView) {
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }, [inView, ref])

  return (
    <video
      ref={ref}
      src={src}
      poster={posterFor(src)}
      muted
      loop
      playsInline
      preload="none"
      className="h-full w-full object-contain"
    />
  )
}

/** 多段连播：进视口后顺序播放并整体循环；离开视口暂停 */
function SeqVideo({ srcs }: { srcs: string[] }): React.ReactElement {
  const [ref, inView] = useInView<HTMLVideoElement>()
  const [idx, setIdx] = useState(0)
  const loadedIdx = useRef(-1)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    // 切到下一段时 src 变了：必须 load() 让 <video> 真正换源，否则连播会卡在上一段
    if (loadedIdx.current !== idx) {
      loadedIdx.current = idx
      v.load()
    }
    if (inView) {
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }, [inView, idx, ref])

  function onEnded(): void {
    setIdx((i) => (i + 1) % srcs.length)
  }

  return (
    <video
      ref={ref}
      src={srcs[idx]}
      poster={posterFor(srcs[0])}
      muted
      playsInline
      preload="none"
      onEnded={onEnded}
      className="h-full w-full object-contain"
    />
  )
}

function VideoCard({ item }: { item: DemoItem }): React.ReactElement {
  return (
    <figure className="overflow-hidden rounded-3xl bg-white ring-1 ring-peach-100">
      <div className="grid aspect-square place-items-center bg-peach-50">
        {item.srcs ? <SeqVideo srcs={item.srcs} /> : <AutoVideo src={item.src!} />}
      </div>
      <figcaption className="px-5 py-4">
        <h3 className="text-base font-bold text-ink">{item.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{item.desc}</p>
      </figcaption>
    </figure>
  )
}

export default function DemoSection(): React.ReactElement {
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
            <VideoCard key={d.title} item={d} />
          ))}
        </div>
      </div>
    </section>
  )
}
