# EchoPet — 情感陪伴桌面宠物

> 基于 EchoMind 多 Agent 框架的 Live2D 桌面宠物。技术栈：**Electron + React + PixiJS v6 + pixi-live2d-display + Live2D Cubism 4 (Hiyori PRO)**。
>
> 当前里程碑：**W1 — 静态人物 + 5 表情按钮 demo（v1.0）**

详细产品规划见 [docs/PRD.md](docs/PRD.md)，架构总览见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，W1 技术方案见 [docs/W1-TECH-PLAN.md](docs/W1-TECH-PLAN.md)。

---

## 仓库结构

```
桌宠/
├── apps/
│   └── desktop/                Electron 桌宠主程序（electron-vite + React + TS）
│       ├── src/
│       │   ├── main/           主进程：透明置顶窗口 + IPC + 鼠标穿透
│       │   ├── preload/        contextBridge 暴露给 renderer 的最小 IPC
│       │   └── renderer/
│       │       └── src/
│       │           ├── live2d/      Live2D 三件套：bootstrap / loader / expressions
│       │           ├── components/  PetCanvas / ChatBubble / DebugExpressionBar
│       │           ├── App.tsx
│       │           └── main.tsx
│       └── public/
│           ├── cubism/         Cubism Core for Web (gitignored, setup 脚本下载)
│           └── live2d/hiyori/  Hiyori PRO 模型 (gitignored, 软链到 hiyori_en/)
├── hiyori_en/hiyori_pro/       Hiyori PRO 原始素材（Live2D 免费素材协议）
├── docs/                       PRD / 架构图 / W1 技术方案 / 等
├── scripts/
│   └── setup-cubism-core.sh    一键拉取 Cubism Core + 软链 Hiyori
├── pnpm-workspace.yaml
└── package.json                workspace root
```

---

## 快速启动

### 0. 前置工具

| 工具 | 版本要求 | 当前我这台 |
| --- | --- | --- |
| Node | ≥ 20 | v24.14 |
| pnpm | ≥ 9 | 11.5.2 |
| git | 任意 | 2.50 |

```bash
# 如果还没装 pnpm
brew install pnpm   # macOS
```

### 1. 装依赖

```bash
git clone <repo> 桌宠
cd 桌宠
pnpm install
```

> pnpm 11+ 第一次 install 会要求显式批准 `electron / esbuild / electron-winstaller` 三个有 build script 的依赖。
> 仓库里 `pnpm-workspace.yaml` 的 `allowBuilds:` 已经把它们都设成 `true`，所以应该一路绿。

### 2. 拉 Live2D 资源

```bash
pnpm setup:cubism
```

这个脚本会：

1. 从 Live2D 官方 CDN `cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` 下载 Cubism Core 到 `apps/desktop/public/cubism/`。
2. 把 `hiyori_en/hiyori_pro/runtime/` 软链到 `apps/desktop/public/live2d/hiyori`。

两项资源都已经在 `.gitignore` 里，不会进 git。

### 3. 启动 dev

```bash
pnpm dev
```

> ⚠️ **必须在原生 Terminal.app / iTerm 里跑，不要在 Cursor 内置终端里跑。**
> 详见下文「已知坑」。

成功的话，屏幕右下角会出现一个 400×600 的透明窗口：上面是欢迎气泡，中间是 Hiyori，下面是 5 个表情按钮。

---

## 已知坑 ( W1 自测时全踩过一遍 )

### 1. Cursor 终端启动 Electron 会 SIGABRT

**症状**：从 Cursor 内置终端跑 `pnpm dev`，electron-vite 显示 "starting electron app..." 后立刻退出，没有窗口出现。
查 `~/Library/Logs/DiagnosticReports/Electron-*.ips` 能看到崩在 `_RegisterApplication` → `+[NSApplication sharedApplication]` → `abort`。

**原因**：macOS 把 Electron 当作 Cursor 子进程，沿用 Cursor 的 LaunchServices coalition；当 Electron 子进程试图自己注册到 Window Server 时，因为 coalition 冲突直接被系统 kill。`responsibleProc: Cursor` 是关键线索。

**修复**：开一个原生的 Terminal.app / iTerm / Warp 窗口，从那里 `cd 桌宠 && pnpm dev`。

### 2. `ELECTRON_RUN_AS_NODE=1` 环境变量泄漏

**症状**：`require('electron')` 返回字符串路径而不是 API 对象；`process.type === undefined`。

**原因**：Cursor 本身是 Electron 应用，为自己的内部 Node 进程设了 `ELECTRON_RUN_AS_NODE=1`，并且这个变量泄漏到了它启动的所有子 shell 里。当我们再起 Electron 时，这个变量会强迫 Electron 以纯 Node 模式运行，不加载 Electron 内置模块。

**修复**：`apps/desktop/package.json` 的 `dev` / `start` 脚本已经前置 `env -u ELECTRON_RUN_AS_NODE`，所以即使父 shell 有这个变量也会被剥离。

### 3. pnpm 11+ 默认拦截 build script

**症状**：`pnpm install` 完输出 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: electron / esbuild / electron-winstaller`，然后 Electron 二进制根本没下载，`electron-vite dev` 起不来。

**修复**：仓库根的 `pnpm-workspace.yaml` 里加：

```yaml
allowBuilds:
  electron: true
  electron-winstaller: true
  esbuild: true
onlyBuiltDependencies:
  - electron
  - electron-winstaller
  - esbuild
```

以及 `.npmrc` 关掉 `strict-dep-builds` + `confirm-modules-purge`。

### 4. PixiJS 版本不能漂到 v7+

`pixi-live2d-display@0.4` 死锁定 `pixi.js@^6` peer。我们在 `apps/desktop/package.json` 把 `pixi.js` 锁到 `~6.5.10`，未来升级要等 `pixi-live2d-display` 出 v7 兼容版本（社区 fork 已有，但稳定性 W1 不押）。

---

## 常用命令

```bash
pnpm dev               # 起 dev server + Electron
pnpm build             # typecheck + 构建到 out/
pnpm typecheck         # 仅静态类型检查（无需 Electron）
pnpm setup:cubism      # 重新拉 Cubism Core + 软链 Hiyori
pnpm --filter @echopet/desktop lint
```

---

## W1 验收检查点

跑 `pnpm dev` 后人肉确认：

1. ☐ 右下角出现 400×600 透明窗口（无窗框、无标题栏）
2. ☐ 窗口透明背景不挡其他应用（鼠标可点穿）
3. ☐ Hiyori 完整渲染（头、身体、双手都在画布内）
4. ☐ 上方的欢迎气泡可见，UI 不被 Hiyori 遮挡
5. ☐ 鼠标悬停在窗口区域 → 鼠标穿透关闭，可以点表情按钮
6. ☐ 5 个表情按钮按下后 Hiyori 切换 motion（动画播放）
7. ☐ Cmd+Shift+Q 全局退出生效

W2 起接入：DeepSeek + EchoMind 对话主链路 + 人格状态机。

---

## 协议 & 致谢

- **Live2D Hiyori PRO**：[Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)，允许个人 / 年营收 1000 万日元以下小企业商用，作品集用途无限制。设计不可二次改动，使用须标注 "Live2D Cubism" 来源。
- **Cubism Core for Web**：Live2D Proprietary Software License，运行时可分发，不进 git。
- **EchoPet 自身代码**：MIT。
