import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
    onError: makeChannel<[string]>('chat:error')
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
    getSnapshot: (): Promise<PersonalitySnapshot> =>
      ipcRenderer.invoke('personality:get-snapshot')
  }
}

try {
  contextBridge.exposeInMainWorld('echopet', echopet)
} catch (error) {
  console.error('[preload] contextBridge failed:', error)
}

export type EchopetAPI = typeof echopet
