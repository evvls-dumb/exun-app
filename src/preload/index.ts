import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { AiEvent } from '../shared/ai'
import type { JanusApi } from '../shared/api'

const api: JanusApi = {
  detectLogsFile: () => ipcRenderer.invoke(IPC.detectLogsFile),
  sessions: {
    list: () => ipcRenderer.invoke(IPC.listSessions),
    create: (logsPath) => ipcRenderer.invoke(IPC.createSession, logsPath),
    open: (id) => ipcRenderer.invoke(IPC.openSession, id)
  },
  machine: {
    report: (sessionId) => ipcRenderer.invoke(IPC.machineReport, sessionId)
  },
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus),
    setKey: (key) => ipcRenderer.invoke(IPC.aiSetKey, key),
    clearKey: () => ipcRenderer.invoke(IPC.aiClearKey),
    conversations: {
      list: () => ipcRenderer.invoke(IPC.aiList),
      get: (id) => ipcRenderer.invoke(IPC.aiGet, id),
      remove: (id) => ipcRenderer.invoke(IPC.aiRemove, id)
    },
    send: (request) => ipcRenderer.invoke(IPC.aiSend, request),
    cancel: (runId) => ipcRenderer.invoke(IPC.aiCancel, runId),
    openFile: (path, reveal) => ipcRenderer.invoke(IPC.aiOpenFile, path, reveal),
    onEvent: (listener) => {
      const handler = (_event: IpcRendererEvent, aiEvent: AiEvent) => listener(aiEvent)
      ipcRenderer.on(IPC.aiEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC.aiEvent, handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('janus', api)
