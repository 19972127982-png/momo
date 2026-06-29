import { app, BrowserWindow, ipcMain, globalShortcut, screen, safeStorage, dialog } from 'electron'
import { basename } from 'node:path'
import { createPetWindow } from './window'
import { createDeepSeekClient } from './companionClient'
import { loadApiKey, saveApiKey, clearApiKey, loadSettings, saveSettings } from './configStore'
import { buildPersonalitySnapshot } from './personality'
import { getDb, closeDb } from './db/connection'
import { SqliteMemoryStore } from './memory/sqliteMemoryStore'
import { maybeExtractProfile } from './memory/profileExtractor'
import { maybeSummarize } from './memory/summarizer'
import { maybeEvolvePersonality } from './memory/personalityEngine'
import { createDeepSeekFcClient } from './fileAgentClient'
import { createLlmIntentClassifier } from './intentClassifier'
import { getMcpHost, ensureServers, closeMcpHost, desktopDir } from './mcp/bootstrap'
import { serversForAgent } from './mcp/serverRegistry'
import type { McpHost } from '@echopet/mcp-host'
import { PermissionGate, extractTarget } from './permission/gate'
import { ToolLogger } from './permission/toolLogger'
import { approvalBridge } from './permission/approvalBridge'
import { SkillManager } from './skills/skillManager'
import { summarizeFile } from './fileSummary'
import { closeOcr } from './fileSummary/ocr'
import type { AppSettings } from '../shared/ipcTypes'
import {
  CompanionAgent,
  FileAgent,
  HybridIntentRouter,
  classifyUtilityAgent,
  DefaultPromptBuilder,
  deriveGrowthStage,
  summarizeUserProfile,
  namespaceToolName,
  type Agent,
  type AgentRunContext,
  type ToolResolution,
  type GrantGrade,
  type UtilityAgentName
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

// W3 D3：SQLite 三层记忆（启动时 init）
let memoryStore: SqliteMemoryStore | null = null
// W4 D2：权限闸 + 工具调用审计（启动时 init，与 db 同生命周期）
let permissionGate: PermissionGate | null = null
let toolLogger: ToolLogger | null = null
// W4 D5：Skills 启用态门面
let skillManager: SkillManager | null = null
// 距上次成功画像提取的轮数 —— 触发「每 5 轮兜底」用；进程级计数，重启归零可接受
let turnsSinceProfileExtraction = 0

// W3 D2：CompanionAgent 全局单例（cheap 对象，stream() 方法每轮重新 spawn）
const companionAgent = new CompanionAgent({
  client: createDeepSeekClient(() => cachedApiKey),
  promptBuilder: new DefaultPromptBuilder(),
  temperature: 1.0,
  maxTokens: 256
})

// W3 D6 / W4：一级路由（陪伴 vs 实用）—— 关键词优先 + LLM zero-shot 兜底
// （关键词判 companion 且带弱任务信号时才触发兜底，纯闲聊零额外延迟）
const intentRouter = new HybridIntentRouter({
  classifier: createLlmIntentClassifier(() => cachedApiKey)
})
const fcClient = createDeepSeekFcClient(() => cachedApiKey)

/** tool-call → 给 UI 的中文状态提示 */
function toolStatusLabel(toolName: string): string {
  const n = toolName.toLowerCase()
  if (n.includes('list') || n.includes('directory')) return '正在看你桌面上有什么…'
  if (n.includes('read')) return '正在读取文件…'
  if (n.includes('search') || n.includes('find')) return '正在查找文件…'
  return '正在调用工具…'
}

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

  // W3 D3：打开 SQLite + 跑迁移 + 播种单行表
  const db = getDb()
  memoryStore = new SqliteMemoryStore(db)
  // W4 D2：权限闸 + 审计（载入已有永久授权）
  permissionGate = new PermissionGate(db)
  toolLogger = new ToolLogger(db)
  // W4 D5：Skills 启用态
  skillManager = new SkillManager(db)

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

  // ---------- 对话主路径（W3 D3-D6：一级路由 → CompanionAgent / FileAgent） ----------
  // 路由判「实用」→ FileAgent 走 MCP function calling（懒启动 filesystem server）；
  // 否则 CompanionAgent：注入工作记忆 + 画像 + 性格 + 情景召回 → 流式。
  // 两条路径共用 post-response：落库 + 互动计数 + 异步画像/情景摘要/性格演化。
  ipcMain.handle('chat:send', async (event, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false as const, error: '空消息' }
    }
    if (!cachedApiKey) {
      event.sender.send('chat:error', '尚未配置 DeepSeek API Key — 点齿轮配置')
      return { ok: false as const, error: 'no-key' }
    }
    if (!memoryStore) {
      event.sender.send('chat:error', '记忆存储未就绪，请重启应用')
      return { ok: false as const, error: 'no-store' }
    }
    const store = memoryStore
    const userInput = text.trim()

    // 还在上一轮 streaming？打断它
    if (chatAbort) {
      chatAbort.abort()
      chatAbort = null
    }
    const ac = new AbortController()
    chatAbort = ac

    const settings = await loadSettings()
    const personaName = settings.petName || '小桃'

    // 一级路由：陪伴 vs 实用
    const route = await intentRouter.route(userInput, { workingMemory: [], signal: ac.signal })

    // 二级路由（utility 时）：选 File / Dev / System，再按需 spawn 它需要的 server。
    // 没有 server 就绪（如 DevAgent 但没装 uvx、或 SystemAgent 暂未实现）→ 降级陪伴。
    let mcpHost: McpHost | null = null
    let readyServerIds: string[] = []
    let pickedAgent: UtilityAgentName = 'FileAgent'
    if (route.mode === 'utility') {
      pickedAgent = classifyUtilityAgent(userInput).agent
      // Skills 门控：只有「启用的 Skill 引入的 server」才允许 spawn。
      // 没开对应 Skill（如关掉文件管家）→ 该 Agent 拿不到工具 → 降级陪伴。
      const allowedServers = skillManager?.enabledServerIds() ?? []
      const wanted = serversForAgent(pickedAgent).filter((id) => allowedServers.includes(id))
      mcpHost = await getMcpHost()
      readyServerIds = await ensureServers(wanted)
      if (readyServerIds.length === 0) {
        console.warn(
          `[chat] 实用模式选了 ${pickedAgent}，但无可用 server（Skill 未启用或启动失败），降级为陪伴`
        )
      }
    }
    const useUtility = route.mode === 'utility' && mcpHost !== null && readyServerIds.length > 0

    // 选择 agent + 组装 ctx
    let agent: Agent
    let ctx: AgentRunContext
    if (useUtility && mcpHost) {
      const host = mcpHost
      const serverIds = readyServerIds
      const [vector, totalInteractions] = await Promise.all([
        store.getPersonality(),
        store.getTotalInteractions()
      ])
      ctx = {
        userInput,
        workingMemory: [],
        userProfileSummary: '',
        recentEpisodicMemories: [],
        personality: vector,
        growthStage: deriveGrowthStage(totalInteractions),
        totalInteractions,
        personaName,
        userCalling: settings.userNickname || undefined,
        signal: ac.signal
      }
      const skillAddon = skillManager?.promptAddon() ?? ''
      const baseHint = `用户的桌面目录绝对路径是：${desktopDir()}\n读写文件时请用这个绝对路径或它的子路径，不要用 ~ 或相对路径。`
      agent = new FileAgent({
        client: fcClient,
        getTools: () => host.listFunctionTools(serverIds),
        getScope: (n: string) => host.scopeOf(n),
        systemHint: skillAddon ? `${baseHint}\n\n${skillAddon}` : baseHint
      })
    } else {
      const [vector, totalInteractions, workingMemory, profile, episodic] = await Promise.all([
        store.getPersonality(),
        store.getTotalInteractions(),
        store.recentMessages(20),
        store.getUserProfile(),
        store.recallEpisodicMemories(userInput, 3)
      ])
      ctx = {
        userInput,
        workingMemory,
        userProfileSummary: summarizeUserProfile(profile),
        recentEpisodicMemories: episodic,
        personality: vector,
        growthStage: deriveGrowthStage(totalInteractions),
        totalInteractions,
        personaName,
        userCalling: settings.userNickname || undefined,
        signal: ac.signal
      }
      agent = companionAgent
    }

    // 先把用户这轮消息落库（即使后面 LLM 失败，用户输入也不该丢）
    await store.appendMessage({ role: 'user', content: userInput, ts: Date.now() })

    let errored = false
    let reply = ''
    try {
      // 手动驱动 generator —— 工作族 Agent 会 yield tool-call，需 next(resolution) 喂回结果。
      // 陪伴族不 yield tool-call，resolution 恒为 undefined，行为与 for-await 等价。
      const gen = agent.run(ctx)
      let result = await gen.next()
      while (!result.done) {
        const ev = result.value
        if (event.sender.isDestroyed()) break
        let resolution: ToolResolution | undefined
        switch (ev.kind) {
          case 'thinking-end':
            // renderer 在 first chunk 到达时自动切 thinking → speaking（W2 已有逻辑）
            break
          case 'text':
            reply += ev.text
            event.sender.send('chat:chunk', ev.text)
            break
          case 'tool-call': {
            const fcName = namespaceToolName(ev.serverId, ev.toolName)
            const target = extractTarget(ev.args)
            // 权限闸：read 透传；write/exec/network 查授权，未命中弹 toast 等审批（D3）
            const decision = permissionGate
              ? permissionGate.check({
                  scope: ev.scope,
                  target,
                  agentName: ev.agentName,
                  serverId: ev.serverId
                })
              : { decision: 'allow' as const, reason: 'auto-read' as const }

            if (decision.decision === 'needs-approval') {
              // 弹审批 toast，阻塞等待用户点击（超时/打断默认拒绝）
              const grade = await approvalBridge.request(
                event.sender,
                {
                  scope: ev.scope,
                  target,
                  agentName: ev.agentName,
                  toolName: ev.toolName
                },
                ac.signal
              )
              if (grade === 'deny') {
                toolLogger?.log({
                  ts: Date.now(),
                  agentName: ev.agentName,
                  serverId: ev.serverId,
                  toolName: ev.toolName,
                  argsSummary: ev.argsSummary,
                  ok: false,
                  deniedReason: 'user-denied'
                })
                resolution = { ok: false, error: '你没同意这次操作，那我先不动它～' }
                break
              }
              // 同意 → 按粒度落地授权（once 不留痕，session/forever 入库/缓存）
              permissionGate?.grant(
                { scope: ev.scope, target, agentName: ev.agentName, serverId: ev.serverId },
                grade
              )
            }

            event.sender.send('chat:tool', toolStatusLabel(ev.toolName))
            const startedAt = Date.now()
            resolution = mcpHost
              ? await mcpHost.invoke(fcName, ev.args)
              : { ok: false, error: '工具不可用' }
            toolLogger?.log({
              ts: startedAt,
              agentName: ev.agentName,
              serverId: ev.serverId,
              toolName: ev.toolName,
              argsSummary: ev.argsSummary,
              resultSummary: resolution.ok ? resolution.resultSummary : resolution.error,
              ok: resolution.ok,
              latencyMs: Date.now() - startedAt
            })
            break
          }
          case 'done':
            event.sender.send('chat:end')
            break
          case 'error':
            errored = true
            event.sender.send('chat:error', ev.error)
            break
        }
        result = await gen.next(resolution)
      }
    } catch (err) {
      errored = true
      const msg = err instanceof Error ? err.message : String(err)
      if (!event.sender.isDestroyed()) event.sender.send('chat:error', `主进程异常：${msg}`)
    }

    if (chatAbort === ac) chatAbort = null

    // ---- post-response：落库 + 互动计数 + 异步画像提取 ----
    if (!errored && reply.trim()) {
      await store.appendMessage({ role: 'assistant', content: reply, ts: Date.now() })
      await store.incrementInteractions()
      turnsSinceProfileExtraction += 1

      // 异步画像提取，不阻塞返回（用独立 signal，不受本轮 ac abort 影响）
      void maybeExtractProfile({
        userMsg: userInput,
        assistantReply: reply,
        turnsSinceLastExtraction: turnsSinceProfileExtraction,
        store,
        getApiKey: () => cachedApiKey,
        signal: new AbortController().signal
      }).then((res) => {
        if (res.updated) turnsSinceProfileExtraction = 0
      })

      // 异步情景记忆摘要（每累计 N 条新消息提炼一次事件卡片，独立 signal）
      void maybeSummarize({
        store,
        getApiKey: () => cachedApiKey,
        signal: new AbortController().signal
      })

      // 异步性格演化（每轮一次 LLM delta → clamp 并入向量 + 写 evolution_log）
      void maybeEvolvePersonality({
        userMsg: userInput,
        assistantReply: reply,
        store,
        getApiKey: () => cachedApiKey,
        signal: new AbortController().signal
      })
    }

    return { ok: !errored }
  })

  ipcMain.on('chat:abort', () => {
    chatAbort?.abort()
    chatAbort = null
  })

  // W4 D3：renderer 点了审批 toast（once/session/forever/deny）→ 喂回正在等待的 tool-call
  ipcMain.on('permission:respond', (_e, reqId: unknown, grade: unknown) => {
    const valid: GrantGrade[] = ['once', 'session', 'forever', 'deny']
    if (typeof reqId === 'string' && valid.includes(grade as GrantGrade)) {
      approvalBridge.resolve(reqId, grade as GrantGrade)
    }
  })

  // 文件选择框 —— 拖放在透明置顶窗口上不可靠，提供 100% 可用的「点击喂文件」入口。
  // 只返回选中的路径，真正的总结仍走 file:summarize（与拖放同一条流式链路）。
  ipcMain.handle('file:pick', async () => {
    const win = petWindow ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: '喂个文件给桌宠看看',
      properties: ['openFile'],
      filters: [
        {
          name: '文本/图片',
          extensions: [
            'txt',
            'md',
            'markdown',
            'json',
            'csv',
            'log',
            'xml',
            'yaml',
            'yml',
            'js',
            'ts',
            'tsx',
            'jsx',
            'py',
            'java',
            'go',
            'rs',
            'c',
            'cpp',
            'h',
            'sh',
            'sql',
            'html',
            'css',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'bmp',
            'gif',
            'tiff'
          ]
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const }
    }
    const filePath = result.filePaths[0]
    return { canceled: false as const, path: filePath, name: basename(filePath) }
  })

  // ---------- 拖文件总结（W3 副线：文本直读 / 图片 OCR → 流式总结，复用 chat 通道） ----------
  ipcMain.handle('file:summarize', async (event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false as const, error: '无效的文件路径' }
    }
    if (!cachedApiKey) {
      event.sender.send('chat:error', '尚未配置 DeepSeek API Key — 点齿轮配置')
      return { ok: false as const, error: 'no-key' }
    }

    // 复用 chat 的打断逻辑：还在上一轮就先 abort
    if (chatAbort) {
      chatAbort.abort()
      chatAbort = null
    }
    const ac = new AbortController()
    chatAbort = ac

    const settings = await loadSettings()
    let errored = false
    try {
      await summarizeFile({
        filePath,
        settings,
        apiKey: cachedApiKey,
        signal: ac.signal,
        emit: {
          chunk: (t) => {
            if (!event.sender.isDestroyed()) event.sender.send('chat:chunk', t)
          },
          end: () => {
            if (!event.sender.isDestroyed()) event.sender.send('chat:end')
          },
          error: (msg) => {
            errored = true
            if (!event.sender.isDestroyed()) event.sender.send('chat:error', msg)
          }
        }
      })
    } catch (err) {
      errored = true
      const msg = err instanceof Error ? err.message : String(err)
      if (!event.sender.isDestroyed()) event.sender.send('chat:error', `总结文件时出错：${msg}`)
    }

    if (chatAbort === ac) chatAbort = null
    return { ok: !errored }
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

  ipcMain.handle('personality:get-snapshot', async () => {
    if (!memoryStore) {
      // store 未就绪时回退到 PRD §4.5 初始锚点
      return buildPersonalitySnapshot({ energy: 0, attachment: 0.2, sensitivity: -0.3 }, 0)
    }
    const [vector, interactions] = await Promise.all([
      memoryStore.getPersonality(),
      memoryStore.getTotalInteractions()
    ])
    return buildPersonalitySnapshot(vector, interactions)
  })

  // ---------- W4 D5：Skills ----------
  ipcMain.handle('skills:list', () => skillManager?.list() ?? [])
  ipcMain.handle('skills:set-enabled', (_e, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') {
      return { ok: false as const, error: '参数错误' }
    }
    const ok = skillManager?.setEnabled(id, enabled) ?? false
    return { ok }
  })

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
  void closeMcpHost()
  void closeOcr()
  closeDb()
})
