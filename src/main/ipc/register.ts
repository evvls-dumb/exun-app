import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { detectLogsFile } from '../logs/detect'
import { createSession, listSessions, openSession } from '../sessions/store'

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

export function registerIpc(): void {
  ipcMain.handle(IPC.detectLogsFile, () => detectLogsFile())

  ipcMain.handle(IPC.listSessions, () => listSessions())

  ipcMain.handle(IPC.createSession, (_event, logsPath: unknown) =>
    createSession(requireString(logsPath, 'logsPath'))
  )

  ipcMain.handle(IPC.openSession, (_event, id: unknown) =>
    openSession(requireString(id, 'id'))
  )
}
