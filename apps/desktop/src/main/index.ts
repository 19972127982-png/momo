import { app, BrowserWindow, ipcMain, globalShortcut, screen, safeStorage } from 'electron'
import { createPetWindow } from './window'
import { createDeepSeekClient } from './companionClient'
import { loadApiKey, saveApiKey, clearApiKey, loadSettings, saveSettings } from './configStore'
import { getPersonalitySnapshot } from './personality'
import type { AppSettings } from '../shared/ipcTypes'
import {
  CompanionAgent,
  DefaultPromptBuilder,
  deriveGrowthStage,
  type AgentRunContext
} from '@echopet/agent-core'

let petWindow: BrowserWindow | null = null

// IPC 拖动：transparent 窗口的 -webkit-app-region: drag 在 Electron 上是 broken 的
// 这里手动用 setInterval 拉光标位置 → win.setPosition 来模拟拖动
let dragInterval: NodeJS.Timeout | null = null
let dragOffset = { x: 0, y: 0 }

function stopDrag(): void {
  if (dragInterval) {
    clearInterval(dragInterval)
    dragInterval = null
  }
}

// LLM 状态：缓存的 key + 当前 streaming 的 AbortController
let cachedApiKey: string | null = null
let chatAbort: AbortController | null = null

// W3 D2：CompanionAgent 全局单例（cheap 对象，stream() 方法每轮重新 spawn）
const companionAgent = new CompanionAgent({
  client: createDeepSeekClient(() => cachedApiKey),
  promptBuilder: new DefaultPromptBuilder(),
  temperature: 1.0,
  maxTokens: 256
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  if (petWindow) {
    if (petWindow.isMinimized()) petWindow.restore()
    petWindow.focus()
  }
})

app.whenReady().then(async () => {
  cachedApiKey = await loadApiKey()

  petWindow = createPetWindow()

  // ---------- 窗口拖动 ----------
  ipcMain.on('pet:drag-start', () => {
    if (!petWindow) return
    const bounds = petWindow.getBounds()
    const cursor = screen.getCursorScreenPoint()
    dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }

    stopDrag()
    dragInterval = setInterval(() => {
      if (!petWindow) {
        stopDrag()
        return
      }
      const cur = screen.getCursorScreenPoint()
      petWindow.setPosition(cur.x - dragOffset.x, cur.y - dragOffset.y)
    }, 16)
  })

  ipcMain.on('pet:drag-end', () => {
    stopDrag()
  })

  // ---------- 陪伴对话主路径（W3 D2：走 CompanionAgent） ----------
  // D2 性格用 personality.ts 的 mock；D3-D5 接入真实 SQLite 三层记忆 + 演化引擎后
  // 这里只需要把工作记忆 / 用户画像 / 情景记忆从对应 store 取出来再注入 ctx。
  ipcMain.handle('chat:send', async (event, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false as const, error: '空消息' }
    }
    if (!cachedApiKey) {
      event.sender.send('chat:error', '尚未配置 DeepSeek API Key — 点齿轮配置')
      return { ok: false as const, error: 'no-key' }
    }

    // 还在上一轮 streaming？打断它
    if (chatAbort) {
      chatAbort.abort()
      chatAbort = null
    }
    const ac = new AbortController()
    chatAbort = ac

    const settings = await loadSettings()
    const snapshot = getPersonalitySnapshot()

    const ctx: AgentRunContext = {
      userInput: text.trim(),
      workingMemory: [],
      userProfileSummary: '',
      recentEpisodicMemories: [],
      personality: {
        energy: snapshot.energy,
        attachment: snapshot.attachment,
        sensitivity: snapshot.sensitivity
      },
      growthStage: deriveGrowthStage(snapshot.interactions),
      totalInteractions: snapshot.interactions,
      personaName: settings.petName || '小桃',
      userCalling: settings.userNickname || undefined,
      signal: ac.signal
    }

    let errored = false
    try {
      for await (const ev of companionAgent.run(ctx)) {
        if (event.sender.isDestroyed()) break
        switch (ev.kind) {
          case 'thinking-end':
            // renderer 在 first chunk 到达时自动切 thinking → speaking（W2 已有逻辑），
            // 主进程不需要单独 IPC 通知。保留这个 case 让 switch 完整覆盖 AgentEvent
            break
          case 'text':
            event.sender.send('chat:chunk', ev.text)
            break
          case 'done':
            event.sender.send('chat:end')
            break
          case 'error':
            errored = true
            event.sender.send('chat:error', ev.error)
            break
          // tool-call event 在 v2.1 CompanionAgent 里永远不会 yield；
          // 工作族 Agent (W3 D6 / W4) 才需要处理
        }
      }
    } catch (err) {
      errored = true
      const msg = err instanceof Error ? err.message : String(err)
      if (!event.sender.isDestroyed()) event.sender.send('chat:error', `主进程异常：${msg}`)
    }

    if (chatAbort === ac) chatAbort = null
    return { ok: !errored }
  })

  ipcMain.on('chat:abort', () => {
    chatAbort?.abort()
    chatAbort = null
  })

  // ---------- 配置 ----------
  ipcMain.handle('config:get-status', () => ({
    hasKey: Boolean(cachedApiKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }))

  ipcMain.handle('config:set-api-key', async (_, key: unknown) => {
    if (typeof key !== 'string') {
      return { ok: false as const, error: 'API Key 必须是字符串' }
    }
    try {
      await saveApiKey(key)
      cachedApiKey = key.trim()
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  })

  ipcMain.handle('config:clear-api-key', async () => {
    try {
      await clearApiKey()
      cachedApiKey = null
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  })

  ipcMain.handle('config:get-settings', () => loadSettings())

  ipcMain.handle('config:set-settings', async (_, patch: unknown) => {
    if (patch !== null && (typeof patch !== 'object' || Array.isArray(patch))) {
      return { ok: false as const, error: 'settings patch 必须是对象' }
    }
    try {
      const next = await saveSettings((patch as Partial<AppSettings>) ?? {})
      return { ok: true as const, settings: next }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  })

  ipcMain.handle('personality:get-snapshot', () => getPersonalitySnapshot())

  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      petWindow = createPetWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  stopDrag()
  chatAbort?.abort()
  globalShortcut.unregisterAll()
})
