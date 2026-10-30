import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { renderPdf } from '../../backend/reports/pdf'
import type { InvestigationStore, CaseFile } from '../../shared/investigation'
import type { AuthResult, Credentials, SetupRequest, VaultState } from '../../shared/privacy'
import { CaseVault, VaultLockedError } from '../security/vault'
import { getPrefs } from '../session/hardening'
import { sealBuffer } from '../security/seal'
import { packBackup, unpackBackup } from '../security/backup'
import { signCaseFile } from '../security/signing'

let vault: CaseVault | null = null
let lastActivity = Date.now()
let autoLockMinutes = 15
let timer: NodeJS.Timeout | null = null
let eventChannel = ''

function theVault(): CaseVault {
  vault ??= new CaseVault(app.getPath('userData'), { wipeAfter: () => getPrefs().wipeAfterFailures })
  return vault
}

function broadcast(): void {
  void vaultState().then((state) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(eventChannel, state)
  })
}

export async function vaultState(): Promise<VaultState> {
  return theVault().status()
}

export async function loadStore(): Promise<InvestigationStore> {
  const store = await theVault().load()
  autoLockMinutes = store.settings.privacy.autoLockMinutes
  return store
}

export async function saveStore(store: InvestigationStore): Promise<void> {
  autoLockMinutes = store.settings.privacy.autoLockMinutes
  touch()
  await theVault().save(store)
}

export { VaultLockedError }

// ---- authentication ----------------------------------------------------------------------------------

const readKeyfile = async (c: Credentials) => (c.keyfilePath ? await readFile(c.keyfilePath) : null)

export function touch(): void {
  lastActivity = Date.now()
}

export function startAutoLock(channel: string): void {
  eventChannel = channel
  if (timer) return
  timer = setInterval(() => {
    void theVault().status().then((s) => {
      if (s.mode !== 'sealed' || s.locked || autoLockMinutes <= 0) return
      if (Date.now() - lastActivity >= autoLockMinutes * 60_000) {
        theVault().lock('inactivity')
        broadcast()
      }
    })
  }, 15_000)
  timer.unref?.()
  app.on('before-quit', () => theVault().lock('app closing'))
}

export async function setupVault(req: SetupRequest): Promise<AuthResult> {
  const { recoveryKey } = await theVault().setup(req.passphrase, { keyfile: await readKeyfile(req), callsign: req.callsign })
  touch()
  broadcast()
  return { state: await vaultState(), recoveryKey }
}

export async function unlockVault(req: Credentials): Promise<AuthResult> {
  const r = await theVault().unlock(req.passphrase, await readKeyfile(req))
  touch()
  broadcast()
  return { state: await vaultState(), recoveryKey: r.recoveryKey }
}

export async function unlockWithRecovery(key: string): Promise<AuthResult> {
  await theVault().unlockWithRecovery(key)
  touch()
  broadcast()
  return { state: await vaultState() }
}

export async function lockVault(reason = 'manual'): Promise<VaultState> {
  theVault().lock(reason)
  broadcast()
  return vaultState()
}

export async function changeCredentials(current: Credentials, next: Credentials): Promise<VaultState> {
  await theVault().changeCredentials(
    { passphrase: current.passphrase, keyfile: await readKeyfile(current) },
    { passphrase: next.passphrase, keyfile: await readKeyfile(next) }
  )
  touch()
  broadcast()
  return vaultState()
}

export async function newRecoveryKey(current: Credentials): Promise<AuthResult> {
  const r = await theVault().newRecovery(current.passphrase, await readKeyfile(current))
  touch()
  return { state: await vaultState(), recoveryKey: r.recoveryKey }
}

/** Crypto-erase. The phrase must be typed exactly; the main process checks it, not the interface. */
export async function destroyVault(phrase: string): Promise<VaultState> {
  if (phrase !== 'DESTROY') throw new Error('Type DESTROY to confirm.')
  await theVault().destroy()
  broadcast()
  return vaultState()
}

export async function securityLog() {
  return theVault().securityLog()
}

export async function myIdentity() {
  const id = await theVault().identity()
  return { fingerprint: id.fingerprint, created: id.created }
}

export async function signBytes(data: Buffer) {
  return theVault().sign(data)
}

export async function backupVault(): Promise<string | null> {
  const parts = await theVault().backupBytes()
  const stamp = new Date().toISOString().slice(0, 10)
  const r = await dialog.showSaveDialog({ title: 'Save an encrypted backup of the case vault', defaultPath: `janus-vault-${stamp}.janus-backup`, filters: [{ name: 'Janus vault backup', extensions: ['janus-backup'] }] })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, packBackup(parts, new Date().toISOString()))
  return r.filePath
}

/** Replace the vault with a backup the person picks. When a vault is already open the phrase RESTORE must be typed. */
export async function restoreVault(phrase: string): Promise<VaultState | null> {
  const before = await vaultState()
  if (before.mode === 'sealed' && phrase !== 'RESTORE') throw new Error('Type RESTORE to confirm. This replaces every case on this computer.')
  const r = await dialog.showOpenDialog({ title: 'Choose a Janus vault backup', properties: ['openFile'], filters: [{ name: 'Janus vault backup', extensions: ['janus-backup'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const parts = unpackBackup(await readFile(r.filePaths[0]))
  await theVault().restore(parts)
  broadcast()
  return vaultState()
}

export async function createKeyfile(): Promise<string | null> {
  const r = await dialog.showSaveDialog({ title: 'Save a new keyfile', defaultPath: 'janus.keyfile', filters: [{ name: 'Janus keyfile', extensions: ['keyfile'] }] })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, randomBytes(64), { mode: 0o600 })
  return r.filePath
}

export async function saveRecoveryKey(key: string): Promise<string | null> {
  if (!/^[A-Z2-7-]{16,80}$/i.test(key.trim())) throw new Error('That does not look like a recovery key.')
  const r = await dialog.showSaveDialog({ title: 'Save your recovery key', defaultPath: 'janus-recovery-key.txt', filters: [{ name: 'Text file', extensions: ['txt'] }] })
  if (r.canceled || !r.filePath) return null
  const text = ['Janus recovery key', '', key.trim(), '', 'This is the only other way into your Janus vault if you forget the passphrase.', 'Keep it somewhere other than this computer. Janus keeps no copy and cannot recover it.', ''].join('\r\n')
  await writeFile(r.filePath, text, { mode: 0o600 })
  return r.filePath
}

export async function pickKeyfile(): Promise<string | null> {
  const r = await dialog.showOpenDialog({ title: 'Choose your keyfile', properties: ['openFile'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

// ---- export ------------------------------------------------------------------------------------------

function slug(title: string): string {
  return title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'case'
}

/** Save a case file. With a passphrase it is written sealed (.janus-enc); without one, as plain JSON.
 *  Any redaction has already been applied by the caller: this function only writes what it is given. */
export async function exportCase(input: CaseFile, passphrase?: string, sign = false): Promise<string | null> {
  // Signing happens last, over exactly what is written, so the signature covers any redaction already applied.
  const file = sign ? await signCaseFile(input, input.exportedBy ?? 'agent', new Date().toISOString(), signBytes) : input
  const sealed = typeof passphrase === 'string' && passphrase.length > 0
  const redacted = !!file.redaction
  const name = `${slug(file.investigation.title)}${redacted ? '.shared' : ''}.janus-case${sealed ? '.janus-enc' : ''}`
  const result = await dialog.showSaveDialog({
    title: sealed ? 'Export investigation (sealed)' : 'Export investigation',
    defaultPath: name,
    filters: sealed ? [{ name: 'Sealed Janus case file', extensions: ['janus-enc'] }] : [{ name: 'Janus case file', extensions: ['janus-case', 'json'] }]
  })
  if (result.canceled || !result.filePath) return null
  const body = Buffer.from(JSON.stringify(file, null, 2), 'utf8')
  await writeFile(result.filePath, sealed ? sealBuffer(body, passphrase as string) : body)
  return result.filePath
}

export async function exportReportPdf(title: string, html: string): Promise<string | null> {
  const result = await dialog.showSaveDialog({ title: 'Export report as PDF', defaultPath: `${slug(title)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, await renderPdf(html))
  shell.openPath(result.filePath)
  return result.filePath
}
