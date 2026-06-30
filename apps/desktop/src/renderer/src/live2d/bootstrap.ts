/**
 * 在 import pixi-live2d-display 之前，把 Cubism Core 注入全局 window
 *
 * 关键约束：
 *   1. Cubism Core 必须在 pixi-live2d-display 模块代码执行前就挂到 window.Live2DCubismCore
 *   2. 不能 import — 它是 IIFE 形式的脚本，需要 <script src> 加载
 *   3. 走 vite public/ 下的 cubism/live2dcubismcore.min.js；路径用 BASE_URL 拼，
 *      dev（base=/）与打包（electron-vite base=./，file:// 加载）都能命中
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
    script.src = `${import.meta.env.BASE_URL}cubism/live2dcubismcore.min.js`
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
          `Cubism Core 加载失败：${script.src} 加载不到（dev 跑 pnpm setup:cubism；打包检查 public/cubism 是否进包）`
        )
      )
    document.head.appendChild(script)
  })

  return bootstrapPromise
}
