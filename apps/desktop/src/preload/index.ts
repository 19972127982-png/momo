import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { AppSettings, PersonalitySnapshot } from '../shared/ipcTypes'

type Unsubscribe = () => void

function makeChannel<T extends unknown[]>(channel: string) {
  return (cb: (...args: T) => void): Unsubscribe => {
    const handler = (_: IpcRendererEvent, ...args: T): void => cb(...args)
    ipcRenderer.on(channel, handler as (...a: unknown[]) => void)
    return () => ipcRenderer.removeListener(channel, handler as (...a: unknown[]) => void)
  }
}

const echopet = {
  pet: {
    startDrag: (): void => ipcRenderer.send('pet:drag-start'),
    endDrag: (): void => ipcRenderer.send('pet:drag-end')
  },
  chat: {
    send: (text: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('chat:send', text),
    abort: (): void => ipcRenderer.send('chat:abort'),
    onChunk: makeChannel<[string]>('chat:chunk'),
    onEnd: makeChannel<[]>('chat:end'),
    onError: makeChannel<[string]>('chat:error'),
    /** 工作族 Agent 调工具时的中文状态提示（如「正在看你桌面上有什么…」） */
    onTool: makeChannel<[string]>('chat:tool')
  },
  file: {
    /** 从拖入的 File 对象拿绝对路径（Electron 30+ 移除了 File.path，须用 webUtils） */
    getPathForFile: (f: File): string => webUtils.getPathForFile(f),
    /** 弹原生文件选择框（拖放在透明置顶窗口上不可靠时的可用入口） */
    pick: (): Promise<{ canceled: boolean; path?: string; name?: string }> =>
      ipcRenderer.invoke('file:pick'),
    /** 让桌宠总结这个文件 —— 结果走 chat:chunk/chat:end/chat:error（与对话同通道） */
    summarize: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('file:summarize', path)
  },
  permission: {
    /** 主进程请求授权（工具调用前）—— 回调收到 {reqId, scope, target, agentName, toolName} */
    onRequest: makeChannel<
      [
        {
          reqId: string
          scope: 'read' | 'write' | 'exec' | 'network'
          target: string
          agentName: string
          toolName: string
        }
      ]
    >('permission:request'),
    /** 用户在 toast 上的选择：once / session / forever / deny */
    respond: (reqId: string, grade: 'once' | 'session' | 'forever' | 'deny'): void =>
      ipcRenderer.send('permission:respond', reqId, grade)
  },
  config: {
    getStatus: (): Promise<{ hasKey: boolean; encryptionAvailable: boolean }> =>
      ipcRenderer.invoke('config:get-status'),
    setApiKey: (key: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('config:set-api-key', key),
    clearApiKey: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('config:clear-api-key'),
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('config:get-settings'),
    setSettings: (
      patch: Partial<AppSettings>
    ): Promise<{ ok: boolean; settings?: AppSettings; error?: string }> =>
      ipcRenderer.invoke('config:set-settings', patch)
  },
  personality: {
    getSnapshot: (): Promise<PersonalitySnapshot> => ipcRenderer.invoke('personality:get-snapshot')
  }
}

try {
  contextBridge.exposeInMainWorld('echopet', echopet)
} catch (error) {
  console.error('[preload] contextBridge failed:', error)
}

export type EchopetAPI = typeof echopet
