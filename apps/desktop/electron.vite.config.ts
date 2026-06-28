import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
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
