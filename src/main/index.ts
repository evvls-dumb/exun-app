import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { safeExternal } from './session/netguard'
import icon from '../assets/icon.png?asset'
import { registerBackend } from '../backend'
import { registerIpc } from './ipc/register'
import { lockVault } from './investigations/store'
import { guardIpc, hardenSession, hardenWindow, loadPrefs, lockOnSleep } from './session/hardening'

const WINDOW_BACKGROUND = '#06080c'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'Janus',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  hardenWindow(window)
  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.janus.app')
  guardIpc()
  hardenSession()
  await loadPrefs()
  registerIpc()
  registerBackend()
  createWindow()
  lockOnSleep((reason) => void lockVault(reason))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
