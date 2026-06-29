import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

const isDev = !!process.env.ELECTRON_RENDERER_URL

export function createPetWindow(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const width = 460
  const height = 760

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
    // 极小非零 alpha（1/255）——纯 #00000000 的透明窗口在 macOS 上不被注册为拖放目标，
    // 给一点点 alpha 能让 NSView 接收系统拖放会话，同时视觉上仍然透明。
    backgroundColor: '#01000000',

    show: false,
    title: 'EchoPet',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 'floating' 而非 'screen-saver'：后者层级过高，macOS 不把它当作拖放目标，
  // 导致文件拖放事件不投递。'floating' 仍在普通窗口之上，且能接收拖放。
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 拖文件进窗口时，若 renderer 没拦住 drop，Electron 默认会导航到 file:// 打开它。
  // 这里兜底阻止任何导航（本应用是单页，永不需要导航）。
  win.webContents.on('will-navigate', (e) => e.preventDefault())

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
