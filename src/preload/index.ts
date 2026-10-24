import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { JanusApi } from '../shared/api'

const api: JanusApi = {
  detectLogsFile: () => ipcRenderer.invoke(IPC.detectLogsFile),
  sessions: {
    list: () => ipcRenderer.invoke(IPC.listSessions),
    create: (logsPath) => ipcRenderer.invoke(IPC.createSession, logsPath),
    open: (id) => ipcRenderer.invoke(IPC.openSession, id)
  }
}

contextBridge.exposeInMainWorld('janus', api)
