import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

const isDev = !!process.env.ELECTRON_RENDERER_URL

export function createPetWindow(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const width = 400
  const height = 600

  const win = new BrowserWindow({
    width,
    height,
    x: workAreaSize.width - width - 40,
    y: workAreaSize.height - height - 40,

    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: '#00000000',

    show: false,
    title: 'EchoPet',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // W1：窗口全程接收鼠标事件（可拖动、可点击按钮）
  // W2 起会改成 hit-test 精细穿透：透明区域穿透到桌面，角色 / UI 上接收
  // win.setIgnoreMouseEvents(true, { forward: true })

  win.once('ready-to-show', () => {
    win.show()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
