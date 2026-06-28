import { app, BrowserWindow, ipcMain, globalShortcut, screen } from 'electron'
import { createPetWindow } from './window'

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

app.whenReady().then(() => {
  petWindow = createPetWindow()

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
  globalShortcut.unregisterAll()
})
