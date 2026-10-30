import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, powerMonitor, session } from 'electron'
import { allowRequest, trustedUrl } from './netguard'
import { DEFAULT_PREFS, normalisePrefs, type Prefs } from '../../shared/prefs'

let prefs: Prefs = { ...DEFAULT_PREFS }
const file = () => join(app.getPath('userData'), 'janus.prefs.json')

export async function loadPrefs(): Promise<Prefs> {
  try {
    prefs = normalisePrefs(JSON.parse(await readFile(file(), 'utf8')))
  } catch {
    prefs = { ...DEFAULT_PREFS }
  }
  return prefs
}

export const getPrefs = (): Prefs => prefs

export async function setPrefs(next: unknown): Promise<Prefs> {
  prefs = normalisePrefs({ ...prefs, ...(typeof next === 'object' && next ? next : {}) })
  await writeFile(file(), JSON.stringify(prefs, null, 2))
  return prefs
}

/** Things every window gets: no navigation away from Janus's own page. */
export function hardenWindow(w: BrowserWindow): void {
  w.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (!(dev && url.startsWith(dev)) && !url.startsWith('file://')) e.preventDefault()
  })
}

/** No camera, microphone, location, notification or other permission is ever granted to the page. */
export function hardenSession(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  // The page makes no network requests at all. The main process enforces it, so it holds even if the page's own
  // content security policy were ever loosened or bypassed.
  const dev = process.env['ELECTRON_RENDERER_URL']
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !allowRequest(details.url, dev) }))
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
  })
}

/** Refuse calls from anything but Janus's own top-level page. Must run before any handler is registered. */
export function guardIpc(): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  const check = (e: { sender: Electron.WebContents; senderFrame: Electron.WebFrameMain | null }): boolean =>
    !!e.senderFrame && e.senderFrame === e.sender.mainFrame && trustedUrl(e.senderFrame.url, dev)
  type Fn = (e: never, ...a: never[]) => unknown
  const handle = ipcMain.handle.bind(ipcMain) as unknown as (c: string, l: Fn) => void
  const on = ipcMain.on.bind(ipcMain) as unknown as (c: string, l: Fn) => void
  ;(ipcMain as unknown as { handle: typeof handle }).handle = (channel, listener) =>
    handle(channel, ((e: Electron.IpcMainInvokeEvent, ...a: never[]) => {
      if (!check(e)) throw new Error('Refused: this request did not come from Janus.')
      return (listener as (...x: unknown[]) => unknown)(e, ...a)
    }) as unknown as Fn)
  ;(ipcMain as unknown as { on: typeof on }).on = (channel, listener) =>
    on(channel, ((e: Electron.IpcMainEvent, ...a: never[]) => {
      if (!check(e)) return
      ;(listener as (...x: unknown[]) => unknown)(e, ...a)
    }) as unknown as Fn)
}

/** Lock when the computer sleeps or its screen is locked: the person has walked away. */
export function lockOnSleep(onLock: (reason: string) => void): void {
  powerMonitor.on('suspend', () => onLock('computer went to sleep'))
  powerMonitor.on('lock-screen', () => onLock('screen locked'))
}
