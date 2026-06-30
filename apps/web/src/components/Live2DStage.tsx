'use client'

import { useEffect, useRef } from 'react'

/**
 * 网页版 Live2D 舞台（桌面端 createPet 的浏览器移植）。
 *
 * - 资产走 Next public：/cubism/live2dcubismcore.min.js、/live2d/hiyori/...
 * - 只在客户端跑：pixi / pixi-live2d-display 都是浏览器库，靠 useEffect 内动态 import
 * - Hiyori 自带 Idle 组会自动循环；speaking=true 时打一发 Tap 让 ta 动一下
 *
 * 关键：canvas 由 pixi 自己创建并 append 到 React 容器 div 内，React 不直接持有 canvas。
 *   这样卸载时 app.destroy(true) 由 pixi 摘除自己的 canvas，避免 React 与 pixi 抢着
 *   removeChild 触发 "NotFoundError: ... not a child of this node"（严格模式双挂载尤甚）。
 */

const CUBISM_SRC = '/cubism/live2dcubismcore.min.js'
const MODEL_PATH = '/live2d/hiyori/hiyori_pro_t11.model3.json'
const FORCE = 3 // MotionPriority.FORCE

let cubismPromise: Promise<void> | null = null
function loadCubismCore(): Promise<void> {
  if (cubismPromise) return cubismPromise
  cubismPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'))
    if ((window as { Live2DCubismCore?: unknown }).Live2DCubismCore) return resolve()
    const script = document.createElement('script')
    script.src = CUBISM_SRC
    script.async = false
    script.onload = () =>
      (window as { Live2DCubismCore?: unknown }).Live2DCubismCore
        ? resolve()
        : reject(new Error('Cubism Core 未注册'))
    script.onerror = () => reject(new Error('Cubism Core 加载失败'))
    document.head.appendChild(script)
  })
  return cubismPromise
}

interface Live2DStageProps {
  speaking?: boolean
  onReady?: () => void
  onError?: (e: Error) => void
  className?: string
}

export default function Live2DStage({
  speaking = false,
  onReady,
  onError,
  className
}: Live2DStageProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const playMotionRef = useRef<(g: string) => void>(() => {})

  useEffect(() => {
    let disposed = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: any = null
    let cleanupResize: (() => void) | null = null

    ;(async () => {
      try {
        const container = containerRef.current
        if (!container) return
        await loadCubismCore()

        const PIXI = await import('pixi.js')
        ;(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI
        const { Live2DModel } = await import('pixi-live2d-display/cubism4')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(Live2DModel as any).registerTicker?.(PIXI.Ticker)

        if (disposed) return

        const w = container.clientWidth || 260
        const h = container.clientHeight || 320

        app = new PIXI.Application({
          width: w,
          height: h,
          backgroundAlpha: 0,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          sharedTicker: true
        })

        // pixi v6：app.view 是它自己创建的 canvas。塞进容器，由 pixi 全权管理。
        const canvas = app.view as HTMLCanvasElement
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'
        container.appendChild(canvas)

        const model = await Live2DModel.from(MODEL_PATH, { autoInteract: false })
        if (disposed) {
          app.destroy(true, { children: true, texture: true, baseTexture: true })
          return
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const im = (model as any).internalModel
        const DESIGN_W: number = im?.originalWidth ?? 1000
        const DESIGN_H: number = im?.originalHeight ?? 1000

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(model as any).anchor.set(0.5, 1.0)
        app.stage.addChild(model)

        const layout = (): void => {
          const pw = container.clientWidth || w
          const ph = container.clientHeight || h
          app.renderer.resize(pw, ph)
          const scale = Math.min(pw / DESIGN_W, ph / DESIGN_H) * 1.05
          if (!Number.isFinite(scale) || scale <= 0) return
          model.scale.set(scale)
          model.x = pw / 2
          model.y = ph * 0.98
        }
        layout()

        const ro = new ResizeObserver(() => layout())
        ro.observe(container)
        window.addEventListener('resize', layout)
        cleanupResize = () => {
          ro.disconnect()
          window.removeEventListener('resize', layout)
        }

        playMotionRef.current = (group: string) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(model as any).motion(group, undefined, FORCE)
          } catch {
            /* 某些组缺失忽略 */
          }
        }

        // 点一下让 ta 动一动（click 仍会冒泡给外层按钮去开/收输入框）
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(model as any).on?.('hit', () => playMotionRef.current('Tap'))

        onReady?.()
      } catch (e) {
        if (!disposed) onError?.(e instanceof Error ? e : new Error(String(e)))
      }
    })()

    return () => {
      disposed = true
      cleanupResize?.()
      try {
        // destroy(true)：pixi 摘除并销毁它自己创建的 canvas（React 不持有它，安全）
        app?.destroy(true, { children: true, texture: true, baseTexture: true })
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // speaking 翻转为 true 时打一发 Tap，让 ta 在"说话"时有动作
  useEffect(() => {
    if (speaking) playMotionRef.current('Tap')
  }, [speaking])

  return <div ref={containerRef} className={className} />
}
