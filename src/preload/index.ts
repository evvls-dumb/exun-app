import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { AiEvent } from '../shared/ai'
import type { JanusApi } from '../shared/api'
import type { InvestigationStore } from '../shared/investigation'
import type { VaultState } from '../shared/privacy'

const api: JanusApi = {
  detectLogsFile: () => ipcRenderer.invoke(IPC.detectLogsFile),
  investigations: {
    load: () => ipcRenderer.invoke(IPC.investigationsLoad),
    save: (store: InvestigationStore) => ipcRenderer.invoke(IPC.investigationsSave, store),
    exportCase: (file, passphrase, sign) => ipcRenderer.invoke(IPC.investigationExport, file, passphrase, sign),
    exportPdf: (title: string, html: string) => ipcRenderer.invoke(IPC.investigationExportPdf, title, html)
  },
  vault: {
    state: () => ipcRenderer.invoke(IPC.vaultState),
    setup: (req) => ipcRenderer.invoke(IPC.vaultSetup, req),
    unlock: (req) => ipcRenderer.invoke(IPC.vaultUnlock, req),
    unlockWithRecovery: (key) => ipcRenderer.invoke(IPC.vaultRecover, key),
    lock: () => ipcRenderer.invoke(IPC.vaultLock),
    change: (current, next) => ipcRenderer.invoke(IPC.vaultChange, current, next),
    newRecovery: (current) => ipcRenderer.invoke(IPC.vaultNewRecovery, current),
    destroy: (phrase) => ipcRenderer.invoke(IPC.vaultDestroy, phrase),
    securityLog: () => ipcRenderer.invoke(IPC.securityLog),
    identity: () => ipcRenderer.invoke(IPC.identityGet),
    backup: () => ipcRenderer.invoke(IPC.vaultBackup),
    restore: (phrase) => ipcRenderer.invoke(IPC.vaultRestore, phrase),
    createKeyfile: () => ipcRenderer.invoke(IPC.keyfileCreate),
    pickKeyfile: () => ipcRenderer.invoke(IPC.keyfilePick),
    saveRecoveryKey: (key) => ipcRenderer.invoke(IPC.recoverySave, key),
    touch: () => ipcRenderer.send(IPC.vaultTouch),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: VaultState) => listener(state)
      ipcRenderer.on(IPC.vaultEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC.vaultEvent, handler)
      }
    }
  },
  prefs: {
    get: () => ipcRenderer.invoke(IPC.prefsGet),
    set: (patch) => ipcRenderer.invoke(IPC.prefsSet, patch)
  },
  intake: {
    pick: (what) => ipcRenderer.invoke(IPC.intakePick, what),
    ingest: (paths, passphrase) => ipcRenderer.invoke(IPC.intakeIngest, paths, passphrase),
    pathsOf: (files) => files.map((f) => webUtils.getPathForFile(f)).filter((p) => p.length > 0)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC.listSessions),
    create: (logsPath) => ipcRenderer.invoke(IPC.createSession, logsPath),
    open: (id) => ipcRenderer.invoke(IPC.openSession, id)
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
