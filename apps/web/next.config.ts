import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pixi.js / pixi-live2d-display 是浏览器端库，交给客户端动态加载
  transpilePackages: ['@echopet/agent-core'],
  experimental: {
    // 允许从 monorepo 根解析 workspace 包
    externalDir: true
  }
}

export default nextConfig
