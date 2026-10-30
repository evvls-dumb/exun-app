import { dialog, ipcMain } from 'electron'
import { isAbsolute } from 'node:path'
import { IPC } from '../../shared/ipc'
import { detectLogsFile } from '../logs/detect'
import { createSession, listSessions, openSession } from '../sessions/store'
import {
  changeCredentials,
  createKeyfile,
  destroyVault,
  exportCase,
  backupVault,
  myIdentity,
  securityLog,
  exportReportPdf,
  loadStore,
  lockVault,
  newRecoveryKey,
  pickKeyfile,
  saveRecoveryKey,
  restoreVault,
  saveStore,
  setupVault,
  startAutoLock,
  touch,
  unlockVault,
  unlockWithRecovery,
  vaultState
} from '../investigations/store'
import { ingestPaths } from '../intake/ingest'
import { getPrefs, setPrefs } from '../session/hardening'
import type { CaseFile, InvestigationStore } from '../../shared/investigation'
import type { Credentials, SetupRequest } from '../../shared/privacy'

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

export function registerIpc(): void {
  ipcMain.handle(IPC.detectLogsFile, () => detectLogsFile())

  ipcMain.handle(IPC.investigationsLoad, () => loadStore())
  ipcMain.handle(IPC.investigationsSave, (_event, store: InvestigationStore) => saveStore(store))
  ipcMain.handle(IPC.investigationExport, (_event, file: CaseFile, passphrase?: unknown, sign?: unknown) =>
    exportCase(file, typeof passphrase === 'string' ? passphrase : undefined, sign === true)
  )

  startAutoLock(IPC.vaultEvent)
  const creds = (v: unknown, name: string): Credentials => {
    const o = (v ?? {}) as Partial<Credentials>
    if (typeof o.passphrase !== 'string' || o.passphrase.length === 0) throw new TypeError(`${name}: passphrase is required`)
    if (o.keyfilePath !== undefined && (typeof o.keyfilePath !== 'string' || !isAbsolute(o.keyfilePath))) throw new TypeError(`${name}: keyfilePath must be an absolute path`)
    return { passphrase: o.passphrase, keyfilePath: o.keyfilePath }
  }
  ipcMain.handle(IPC.vaultState, () => vaultState())
  ipcMain.handle(IPC.vaultSetup, (_e, req: unknown) => {
    const callsign = typeof (req as SetupRequest)?.callsign === 'string' ? (req as SetupRequest).callsign : ''
    return setupVault({ ...creds(req, 'setup'), callsign })
  })
  ipcMain.handle(IPC.vaultUnlock, (_e, req: unknown) => unlockVault(creds(req, 'unlock')))
  ipcMain.handle(IPC.vaultRecover, (_e, key: unknown) => unlockWithRecovery(requireString(key, 'recovery key')))
  ipcMain.handle(IPC.vaultLock, () => lockVault('manual'))
  ipcMain.handle(IPC.vaultChange, (_e, a: unknown, b: unknown) => changeCredentials(creds(a, 'current'), creds(b, 'next')))
  ipcMain.handle(IPC.vaultNewRecovery, (_e, a: unknown) => newRecoveryKey(creds(a, 'current')))
  ipcMain.handle(IPC.vaultDestroy, (_e, phrase: unknown) => destroyVault(requireString(phrase, 'phrase')))
  ipcMain.handle(IPC.securityLog, () => securityLog())
  ipcMain.handle(IPC.identityGet, () => myIdentity())
  ipcMain.handle(IPC.vaultBackup, () => backupVault())
  ipcMain.handle(IPC.vaultRestore, (_e, phrase: unknown) => restoreVault(typeof phrase === 'string' ? phrase : ''))
  ipcMain.handle(IPC.keyfileCreate, () => createKeyfile())
  ipcMain.handle(IPC.keyfilePick, () => pickKeyfile())
  ipcMain.handle(IPC.recoverySave, (_e, key: unknown) => saveRecoveryKey(requireString(key, 'recovery key')))
  ipcMain.handle(IPC.prefsGet, () => getPrefs())
  ipcMain.handle(IPC.prefsSet, (_e, patch: unknown) => setPrefs(patch))
  ipcMain.on(IPC.vaultTouch, () => touch())

  ipcMain.handle(IPC.intakePick, async (_e, what: unknown) => {
    const folder = what === 'folder'
    const result = await dialog.showOpenDialog({
      title: folder ? 'Add a folder of case material' : 'Add case files',
      properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IPC.intakeIngest, (_e, paths: unknown, passphrase?: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200 || !paths.every((p) => typeof p === 'string' && isAbsolute(p))) {
      throw new TypeError('paths must be a list of absolute file paths')
    }
    touch()
    return ingestPaths(paths as string[], {
      passphrase: typeof passphrase === 'string' && passphrase ? passphrase : undefined,
      today: new Date().toISOString().slice(0, 10)
    })
  })
  ipcMain.handle(IPC.investigationExportPdf, (_event, title: string, html: string) => exportReportPdf(title, html))

  ipcMain.handle(IPC.listSessions, () => listSessions())

  ipcMain.handle(IPC.createSession, (_event, logsPath: unknown) =>
    createSession(requireString(logsPath, 'logsPath'))
  )

  ipcMain.handle(IPC.openSession, (_event, id: unknown) =>
    openSession(requireString(id, 'id'))
  )
}
