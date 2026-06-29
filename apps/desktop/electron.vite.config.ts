import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite 默认把 package.json 的 dependencies 全部 externalize（让 Node 运行时加载）。
// 但 @echopet/* 是 monorepo 内的 TS 源码包（main 字段指向 src/*.ts），Node 原生 ESM
// 既不能跑 .ts，也无法解析其无扩展名的相对 import。所以必须把它们打进 main bundle。
const WORKSPACE_PACKAGES = [
  '@echopet/agent-core',
  '@echopet/state-machine',
  '@echopet/mcp-host'
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })]
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })]
  },
  renderer: {
    // electron-vite renderer 默认 publicDir 是 src/renderer/public/
    // 显式指到 apps/desktop/public/ ：Cubism Core + Hiyori 软链都放那里
    publicDir: resolve(__dirname, 'public'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
