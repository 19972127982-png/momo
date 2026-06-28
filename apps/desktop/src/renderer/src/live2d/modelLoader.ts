/**
 * 用 PIXI v6 + pixi-live2d-display 0.4 加载 Hiyori PRO（Cubism 4）
 *
 * 坐标 / 缩放策略：
 *   - 完全不用 PIXI.pivot —— Live2DModel 渲染时会按自己的 modelMatrix 重算变换，
 *     pivot 会和它打架，造成 motion 切换瞬间视觉漂移。
 *   - 改用 pixi-live2d-display 在 Live2DModel 上原生封装的 anchor（0~1），
 *     它是模型自己的锚点 API，专门处理 Cubism 坐标系。
 *   - 把锚点放在「底部正中 (0.5, 1)」+ position y = canvasHeight。
 *     这样无论 motion 怎么让身体上下伸缩，「脚」始终钉在画布底部。
 *   - scale 只看画布尺寸和 internalModel.originalWidth/originalHeight
 *     （.moc3 内嵌的设计画布尺寸，永不变化），与 motion 完全解耦。
 *
 * 其他关键点：
 *   - pixi-live2d-display 0.4 需要 Live2DModel.registerTicker(PIXI.Ticker) 才会自动 update
 *   - PIXI.Application sharedTicker: true，让 render tick 和 model.update tick 同步
 */

import * as PIXI from 'pixi.js'
import { bootstrapLive2D } from './bootstrap'
import { STATE_BY_KEY, type StateKey } from './states'

const HIYORI_MODEL_PATH = '/live2d/hiyori/hiyori_pro_t11.model3.json'

const DEBUG_BG = false

export interface PetController {
  app: PIXI.Application
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any
  playState: (key: StateKey) => void
  destroy: () => void
}

function readSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const parent = canvas.parentElement
  const w = canvas.clientWidth || parent?.clientWidth || 400
  const h = canvas.clientHeight || parent?.clientHeight || 500
  return { w, h }
}

export async function createPet(canvas: HTMLCanvasElement): Promise<PetController> {
  await bootstrapLive2D()

  ;(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI

  const live2d = await import('pixi-live2d-display/cubism4')
  const { Live2DModel } = live2d

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Live2DModel as any).registerTicker?.(PIXI.Ticker)

  const initial = readSize(canvas)

  const app = new PIXI.Application({
    view: canvas,
    width: initial.w,
    height: initial.h,
    backgroundColor: DEBUG_BG ? 0x880000 : 0x000000,
    backgroundAlpha: DEBUG_BG ? 0.25 : 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    sharedTicker: true
  })

  const model = await Live2DModel.from(HIYORI_MODEL_PATH, { autoInteract: false })

  // .moc3 设计画布尺寸 —— 不变量，layout 的唯一基准
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const im = (model as any).internalModel
  const DESIGN_W: number = im?.originalWidth ?? 1000
  const DESIGN_H: number = im?.originalHeight ?? 1000

  // 底部正中锚点：脚钉在画布底部，motion 引起的身体伸缩只往上长，不漂
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(model as any).anchor.set(0.5, 1.0)
  app.stage.addChild(model)

  const layout = (): void => {
    const { w, h } = readSize(canvas)
    app.renderer.resize(w, h)

    const scale = Math.min(w / DESIGN_W, h / DESIGN_H) * 0.9
    if (!Number.isFinite(scale) || scale <= 0) return

    model.scale.set(scale)
    model.x = w / 2
    model.y = h * 0.94 // 整体上移 6%，给下方留点呼吸 + 避免脚被状态栏挡
  }

  layout()

  const ro = new ResizeObserver(() => layout())
  ro.observe(canvas)
  window.addEventListener('resize', layout)

  // pixi-live2d-display 的 MotionPriority enum: NONE=0 IDLE=1 NORMAL=2 FORCE=3
  // 默认 NORMAL 会被当前 NORMAL motion 阻塞 —— 用户连点按钮看起来像「按顺序播」
  // 实际是后续点击全被 drop。用 FORCE 强制打断、立即切换。
  const FORCE = 3

  const playState = (key: StateKey): void => {
    const meta = STATE_BY_KEY[key]
    if (!meta) return
    try {
      // 第二参数 undefined → pixi-live2d-display 在 group 内随机选一个 motion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(model as any).motion(meta.group, undefined, FORCE)
    } catch (err) {
      console.warn(`[pet] motion ${meta.group} failed`, err)
    }
  }

  const destroy = (): void => {
    ro.disconnect()
    window.removeEventListener('resize', layout)
    try {
      app.destroy(true, { children: true, texture: true, baseTexture: true })
    } catch (err) {
      console.warn('[pet] destroy failed', err)
    }
  }

  return { app, model, playState, destroy }
}
