import { contextBridge, ipcRenderer } from 'electron'

const echopet = {
  pet: {
    startDrag: (): void => ipcRenderer.send('pet:drag-start'),
    endDrag: (): void => ipcRenderer.send('pet:drag-end')
  }
}

try {
  contextBridge.exposeInMainWorld('echopet', echopet)
} catch (error) {
  console.error('[preload] contextBridge failed:', error)
}

export type EchopetAPI = typeof echopet
