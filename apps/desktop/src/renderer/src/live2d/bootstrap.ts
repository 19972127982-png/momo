/**
 * 在 import pixi-live2d-display 之前，把 Cubism Core 注入全局 window
 *
 * 关键约束：
 *   1. Cubism Core 必须在 pixi-live2d-display 模块代码执行前就挂到 window.Live2DCubismCore
 *   2. 不能 import — 它是 IIFE 形式的脚本，需要 <script src> 加载
 *   3. 走 vite public/ 下的 /cubism/live2dcubismcore.min.js，dev 和 prod 都能命中
 */

declare global {
  interface Window {
    Live2DCubismCore?: unknown
    PIXI?: unknown
  }
}

let bootstrapPromise: Promise<void> | null = null

export function bootstrapLive2D(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = new Promise<void>((resolve, reject) => {
    if (window.Live2DCubismCore) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = '/cubism/live2dcubismcore.min.js'
    script.async = false
    script.onload = () => {
      if (window.Live2DCubismCore) {
        resolve()
      } else {
        reject(new Error('Cubism Core 加载完但 window.Live2DCubismCore 未注册'))
      }
    }
    script.onerror = () =>
      reject(
        new Error(
          'Cubism Core 加载失败：检查 apps/desktop/public/cubism/live2dcubismcore.min.js 是否存在 ( 跑 pnpm setup:cubism )'
        )
      )
    document.head.appendChild(script)
  })

  return bootstrapPromise
}
