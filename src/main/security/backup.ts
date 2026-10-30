// A vault backup is one file holding the sealed vault and the file that wraps its key. It is as safe to store
// as the vault itself: opening it still takes the passphrase (and keyfile, if one was set) or the recovery key.
// Pure, so it can be tested without Electron.
import { isSealed } from './seal'

export const BACKUP_SCHEMA = 'janus.backup/1'

export interface BackupParts {
  vault: Buffer
  keys: Buffer
  /** The agent's signing identity, encrypted under the vault's key. Absent in older backups. */
  identity?: Buffer
}

export function packBackup(parts: BackupParts, now: string): Buffer {
  return Buffer.from(JSON.stringify({ schema: BACKUP_SCHEMA, createdAt: now, keys: parts.keys.toString('base64'), vault: parts.vault.toString('base64'), ...(parts.identity && { identity: parts.identity.toString('base64') }) }, null, 2), 'utf8')
}

export class BadBackupError extends Error {
  constructor(why: string) {
    super(`This is not a usable Janus vault backup: ${why}`)
    this.name = 'BadBackupError'
  }
}

/** Check the file is a Janus backup and that both parts look right, before anything on disk is touched. */
export function unpackBackup(bytes: Buffer): BackupParts {
  let raw: { schema?: unknown; keys?: unknown; vault?: unknown; identity?: unknown }
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new BadBackupError('it is not readable.')
  }
  if (raw.schema !== BACKUP_SCHEMA) throw new BadBackupError('wrong file type or version.')
  if (typeof raw.keys !== 'string' || typeof raw.vault !== 'string') throw new BadBackupError('a part is missing.')
  const keys = Buffer.from(raw.keys, 'base64')
  const vault = Buffer.from(raw.vault, 'base64')
  if (!isSealed(vault)) throw new BadBackupError('the vault inside is not sealed.')
  try {
    const k = JSON.parse(keys.toString('utf8')) as { v?: unknown; slots?: unknown }
    if (k.v !== 2 || !Array.isArray(k.slots) || k.slots.length === 0) throw new Error()
  } catch {
    throw new BadBackupError('the key file inside is damaged.')
  }
  const identity = typeof raw.identity === 'string' ? Buffer.from(raw.identity, 'base64') : undefined
  if (identity && !isSealed(identity)) throw new BadBackupError('the identity inside is not sealed.')
  return { vault, keys, ...(identity && { identity }) }
}
