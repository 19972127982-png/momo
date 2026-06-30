# @echopet/web

EchoPet 作品集网站 —— 产品介绍 + 在线「小桃」陪聊。

- **技术栈**：Next.js 16（App Router）+ TypeScript + Tailwind v4
- **右下角小桃**：复用桌面端同款 Live2D（Hiyori PRO）+ DeepSeek 陪伴 prompt
- **只陪聊**：涉及整理文件 / 剪贴板 / 提醒等「动手」意图时，前端用 `@echopet/agent-core`
  的关键词路由（`classifyIntentByKeywords`）当场短路成「下载 App」引导，**网页永不调工具**

## 本地开发

```bash
# 仓库根目录已 pnpm install 过的话，直接：
cd apps/web
cp .env.example .env.local   # 填入 DEEPSEEK_API_KEY
pnpm dev                     # http://localhost:3000
```

没填 `DEEPSEEK_API_KEY` 时，页面照常显示、工具意图引导也能用，只有真正闲聊会返回
「服务暂未配置」。

## 构建

```bash
pnpm build && pnpm start
```

## 部署到 Vercel

1. New Project → 选本仓库，**Root Directory 设为 `apps/web`**。
2. Framework 自动识别为 Next.js，Build/Install 用默认即可（pnpm workspace 会被识别）。
3. Environment Variables 加一条 `DEEPSEEK_API_KEY`。
4. Deploy。

## /api/chat 代理的护栏

服务端代理（`src/app/api/chat/route.ts`）持密钥，并做了多重控成本 / 防滥用：

- **仅陪伴 prompt**：系统提示写死陪聊人格，网页不挂任何工具
- **IP 限流**：每 IP 每 5 分钟最多 15 次（内存滑动窗口，best-effort；要严格全局限流可换 Upstash Redis，接口不变）
- **硬上限**：历史最多 12 条、单条 ≤500 字、总输入 ≤4000 字、回复 `max_tokens=240`

## 资产

`public/cubism`、`public/live2d` 是从 `apps/desktop/public` 拷过来的 Live2D 资产，
**已随仓库提交**（Vercel 构建需要）。更新模型时重新拷贝即可。
