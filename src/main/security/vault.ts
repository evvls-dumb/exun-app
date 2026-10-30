// The case vault: where investigations live on disk, sealed under a key hierarchy (see keyslots.ts).
//
//   janus.keys            the wrapped data key(s): passphrase slot (optionally + keyfile) and recovery slot
//   investigations.vault  the cases, AES-256-GCM under the data key (the JANUSENC container; its salt and
//                         cost fields are unused here, the key is not derived from them)
//   janus.attempts        consecutive wrong tries and when, for throttling
//
// The data key lives in memory only while unlocked and is zeroed on lock. Saves are atomic and keep the
// previous sealed copy as .bak. Vaults written by the earlier version (passphrase-derived key straight into
// investigations.vault) open once and are upgraded in place.
//
// Throttling slows a person at the keyboard. It cannot slow someone who copies the files and guesses offline;
// against that, only the passphrase's strength and the scrypt cost count.
//
// No Electron imports: the folder is injected, so the logic runs and is tested in plain Node.

import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readAudit, appendAudit, type AuditReport } from './auditlog'
import { fingerprintOf } from './signing'
import { sign as edSign, createPrivateKey } from 'node:crypto'
import { emptyStore, normaliseSettings, type InvestigationStore } from '../../shared/investigation'
import {
  BadCredentialsError,
  KeyfileRequiredError,
  formatRecoveryKey,
  makePassphraseSlot,
  makeRecoverySlot,
  newRecoveryKey,
  openPassphraseSlot,
  openRecoverySlot,
  parseRecoveryKey,
  SLOT_KDF,
  throttleMs,
  ThrottledError,
  type Slot,
  type SlotKdf
} from './keyslots'
import { DEFAULT_KDF, decryptWithKey, deriveKeyAsync, encryptWithKey, isSealed, MIN_PASSPHRASE, readHeader } from './seal'

export { BadCredentialsError, KeyfileRequiredError, ThrottledError }

export class VaultWipedError extends Error {
  constructor(readonly after: number) {
    super(`The vault was erased after ${after} wrong attempts, as you set it to.`)
    this.name = 'VaultWipedError'
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super('The case vault is locked.')
    this.name = 'VaultLockedError'
  }
}

export interface VaultStatus {
  /** plain: stored unencrypted (only before setup). sealed: stored encrypted. */
  mode: 'plain' | 'sealed'
  locked: boolean
  /** The passphrase slot also needs a keyfile. */
  keyfile: boolean
  /** True when nothing exists yet: the first run, which needs setup. */
  empty: boolean
  /** Milliseconds until another attempt is allowed. */
  waitMs: number
  /** Wrong attempts since the last success. */
  failed: number
}

interface KeysFile {
  v: 2
  kdf: SlotKdf
  created: string
  slots: Slot[]
}

interface Attempts {
  fails: number
  last: number
  /** Lifetime count, shown to the owner so a stranger's guessing is visible. */
  total: number
}

export interface SetupResult {
  /** Shown to the person once and never stored. */
  recoveryKey: string
}

export interface VaultOptions {
  kdf?: SlotKdf
  now?: () => number
  /** Erase the vault after this many wrong attempts in a row. 0 or absent: never. Read on every wrong attempt. */
  wipeAfter?: () => number
}

export interface Identity {
  /** SPKI DER, base64. */
  publicKey: string
  fingerprint: string
  created: string
}

const PLAIN = 'investigations.json'
const SEALED = 'investigations.vault'
const KEYS = 'janus.keys'
const ATTEMPTS = 'janus.attempts'
const AUDIT = 'janus.audit'
const IDENTITY = 'janus.identity'

export function normaliseStore(raw: unknown): InvestigationStore {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<InvestigationStore>
  return {
    investigations: Array.isArray(record.investigations) ? record.investigations : [],
    evidence: Array.isArray(record.evidence) ? record.evidence : [],
    reports: record.reports && typeof record.reports === 'object' ? record.reports : {},
    logs: record.logs && typeof record.logs === 'object' ? record.logs : {},
    settings: normaliseSettings(record.settings),
    actions: record.actions && typeof record.actions === 'object' ? record.actions : {},
    signers: record.signers && typeof record.signers === 'object' ? record.signers : {}
  }
}

async function atomicWrite(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

/** Best-effort: overwrite then remove. On SSDs and journaling filesystems an overwrite does not guarantee
 *  the old bytes are gone; what makes destruction real is that the keys are gone and the data is encrypted. */
async function scrub(path: string): Promise<void> {
  try {
    const { size } = await stat(path)
    await writeFile(path, randomBytes(Math.min(size, 64 * 1024 * 1024)))
  } catch {
    // nothing to overwrite
  }
  await unlink(path).catch(() => {})
}

export class CaseVault {
  private dek: Buffer | null = null
  private readonly kdf: SlotKdf
  private readonly now: () => number
  private readonly wipeAfter: () => number
  private auditQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly dir: string,
    options: VaultOptions = {}
  ) {
    this.kdf = options.kdf ?? SLOT_KDF
    this.now = options.now ?? Date.now
    this.wipeAfter = options.wipeAfter ?? (() => 0)
  }

  // ---- security log ----

  /** Queue an entry. Entries are written one at a time, in order. Failure to log never blocks the vault. */
  private audit(event: string, detail = ''): Promise<void> {
    const time = new Date(this.now()).toISOString()
    this.auditQueue = this.auditQueue.then(() => appendAudit(this.p(AUDIT), event, detail, time)).catch(() => {})
    return this.auditQueue
  }

  /** Wait for pending log writes (tests, and before the process exits). */
  flushAudit(): Promise<void> {
    return this.auditQueue
  }

  async securityLog(): Promise<AuditReport> {
    await this.auditQueue
    return readAudit(this.p(AUDIT))
  }

  private p(name: string): string {
    return join(this.dir, name)
  }

  private async readKeys(): Promise<KeysFile | null> {
    try {
      const k = JSON.parse(await readFile(this.p(KEYS), 'utf8')) as KeysFile
      return k.v === 2 && Array.isArray(k.slots) ? k : null
    } catch {
      return null
    }
  }

  private async readAttempts(): Promise<Attempts> {
    try {
      const a = JSON.parse(await readFile(this.p(ATTEMPTS), 'utf8')) as Attempts
      return { fails: a.fails | 0, last: a.last | 0, total: a.total | 0 }
    } catch {
      return { fails: 0, last: 0, total: 0 }
    }
  }

  async status(): Promise<VaultStatus> {
    const sealed = existsSync(this.p(SEALED)) || existsSync(this.p(KEYS))
    const keys = sealed ? await this.readKeys() : null
    const a = await this.readAttempts()
    const wait = Math.max(0, a.last + throttleMs(a.fails) - this.now())
    return {
      mode: sealed ? 'sealed' : 'plain',
      locked: sealed && this.dek === null,
      keyfile: !!keys?.slots.find((s) => s.id === 'passphrase')?.keyfile,
      empty: !sealed && !existsSync(this.p(PLAIN)),
      waitMs: sealed ? wait : 0,
      failed: a.fails
    }
  }

  async attempts(): Promise<Attempts> {
    return this.readAttempts()
  }

  // ---- reading and writing the cases ----

  async load(): Promise<InvestigationStore> {
    if (existsSync(this.p(SEALED))) {
      if (!this.dek) throw new VaultLockedError()
      const plain = decryptWithKey(await readFile(this.p(SEALED)), this.dek)
      return normaliseStore(JSON.parse(plain.toString('utf8')))
    }
    try {
      return normaliseStore(JSON.parse(await readFile(this.p(PLAIN), 'utf8')))
    } catch {
      return emptyStore()
    }
  }

  async save(store: InvestigationStore): Promise<void> {
    if (existsSync(this.p(SEALED)) || existsSync(this.p(KEYS))) {
      if (!this.dek) throw new VaultLockedError()
      await this.writeSealed(store, this.dek)
      return
    }
    await atomicWrite(this.p(PLAIN), JSON.stringify(store, null, 2))
  }

  private async writeSealed(store: InvestigationStore, dek: Buffer): Promise<void> {
    const sealed = encryptWithKey(Buffer.from(JSON.stringify(store), 'utf8'), dek, { salt: randomBytes(16), ...DEFAULT_KDF })
    if (existsSync(this.p(SEALED))) await rename(this.p(SEALED), `${this.p(SEALED)}.bak`).catch(() => {})
    await atomicWrite(this.p(SEALED), sealed)
  }

  // ---- setting up ----

  /** Create the key hierarchy and seal what is there (first run: nothing; upgrade: the unencrypted cases).
   *  Returns the recovery key, to be shown to the person exactly once. */
  async setup(passphrase: string, options: { keyfile?: Buffer | null; callsign?: string } = {}): Promise<SetupResult> {
    if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`)
    if (existsSync(this.p(KEYS)) || existsSync(this.p(SEALED))) throw new Error('The vault is already set up.')
    const store = await this.load()
    if (options.callsign?.trim()) store.settings.agent = options.callsign.trim().slice(0, 40)
    const dek = randomBytes(32)
    const recovery = newRecoveryKey()
    const keys: KeysFile = {
      v: 2,
      kdf: this.kdf,
      created: new Date(this.now()).toISOString(),
      slots: [await makePassphraseSlot(dek, passphrase, this.kdf, options.keyfile), makeRecoverySlot(dek, recovery)]
    }
    // Prove the sealed copy and both slots open before anything unencrypted is removed.
    const sealed = encryptWithKey(Buffer.from(JSON.stringify(store), 'utf8'), dek, { salt: randomBytes(16), ...DEFAULT_KDF })
    decryptWithKey(sealed, dek)
    await atomicWrite(this.p(KEYS), JSON.stringify(keys, null, 2))
    await atomicWrite(this.p(SEALED), sealed)
    this.dek = dek
    await this.clearAttempts()
    if (existsSync(this.p(PLAIN))) await scrub(this.p(PLAIN))
    await this.audit('vault:setup', 'passphrase slot' + (options.keyfile ? ' + keyfile' : '') + ', recovery slot')
    await this.identity()
    return { recoveryKey: formatRecoveryKey(recovery) }
  }

  // ---- unlocking ----

  private async gate(): Promise<Attempts> {
    const a = await this.readAttempts()
    const wait = a.last + throttleMs(a.fails) - this.now()
    if (wait > 0) throw new ThrottledError(wait)
    return a
  }

  private async fail(a: Attempts, how: string): Promise<void> {
    await atomicWrite(this.p(ATTEMPTS), JSON.stringify({ fails: a.fails + 1, last: this.now(), total: a.total + 1 }))
    await this.audit('unlock:fail', `${how}; ${a.fails + 1} wrong in a row`)
    const limit = this.wipeAfter()
    if (limit > 0 && a.fails + 1 >= limit) {
      await this.destroy()
      await this.audit('vault:wiped', `erased automatically after ${limit} wrong attempts`)
      throw new VaultWipedError(limit)
    }
  }

  private async clearAttempts(): Promise<void> {
    const a = await this.readAttempts()
    await atomicWrite(this.p(ATTEMPTS), JSON.stringify({ fails: 0, last: 0, total: a.total }))
  }

  /** Open with the passphrase (and keyfile if the vault needs one). An earlier-version vault is opened and
   *  upgraded; in that case the new recovery key is returned. */
  async unlock(passphrase: string, keyfile?: Buffer | null): Promise<{ recoveryKey?: string }> {
    if (!existsSync(this.p(SEALED)) && !existsSync(this.p(KEYS))) return {}
    const a = await this.gate()
    try {
      const keys = await this.readKeys()
      if (!keys) {
        const upgraded = await this.upgradeLegacy(passphrase, keyfile)
        await this.clearAttempts()
        await this.audit('unlock:ok', 'passphrase; vault upgraded to key slots')
        return upgraded
      }
      const slot = keys.slots.find((s) => s.id === 'passphrase')
      if (!slot) throw new BadCredentialsError()
      this.dek = await openPassphraseSlot(slot, passphrase, keys.kdf, keyfile)
      await this.clearAttempts()
      await this.audit('unlock:ok', keyfile ? 'passphrase + keyfile' : 'passphrase')
      return {}
    } catch (e) {
      if (e instanceof BadCredentialsError) await this.fail(a, 'passphrase')
      throw e
    }
  }

  async unlockWithRecovery(recoveryKey: string): Promise<void> {
    const a = await this.gate()
    const keys = await this.readKeys()
    if (!keys) throw new Error('This vault predates recovery keys.')
    const slot = keys.slots.find((s) => s.id === 'recovery')
    try {
      if (!slot) throw new BadCredentialsError()
      this.dek = openRecoverySlot(slot, parseRecoveryKey(recoveryKey))
      await this.clearAttempts()
      await this.audit('unlock:ok', 'recovery key')
    } catch (e) {
      if (e instanceof BadCredentialsError) await this.fail(a, 'recovery key')
      throw e
    }
  }

  private async upgradeLegacy(passphrase: string, keyfile?: Buffer | null): Promise<{ recoveryKey: string }> {
    const data = await readFile(this.p(SEALED))
    if (!isSealed(data)) throw new Error('The vault file is damaged.')
    const header = readHeader(data)
    const key = await deriveKeyAsync(passphrase, header.salt, header)
    let plain: Buffer
    try {
      plain = decryptWithKey(data, key)
    } catch {
      throw new BadCredentialsError()
    }
    const store = normaliseStore(JSON.parse(plain.toString('utf8')))
    await rename(this.p(SEALED), `${this.p(SEALED)}.v1.bak`).catch(() => {})
    const dek = randomBytes(32)
    const recovery = newRecoveryKey()
    const keys: KeysFile = {
      v: 2,
      kdf: this.kdf,
      created: new Date(this.now()).toISOString(),
      slots: [await makePassphraseSlot(dek, passphrase, this.kdf, keyfile), makeRecoverySlot(dek, recovery)]
    }
    await atomicWrite(this.p(KEYS), JSON.stringify(keys, null, 2))
    await this.writeSealed(store, dek)
    await scrub(`${this.p(SEALED)}.v1.bak`)
    this.dek = dek
    return { recoveryKey: formatRecoveryKey(recovery) }
  }

  /** Forget the data key. The reason is only for the security log. */
  lock(reason = 'manual'): void {
    if (this.dek) {
      this.dek.fill(0)
      this.dek = null
      void this.audit('lock', reason)
    }
  }

  // ---- changing credentials (requires the vault to be unlocked, and the current passphrase again) ----

  private async reauth(passphrase: string, keyfile?: Buffer | null): Promise<KeysFile> {
    if (!this.dek) throw new VaultLockedError()
    const a = await this.gate()
    const keys = await this.readKeys()
    const slot = keys?.slots.find((s) => s.id === 'passphrase')
    if (!keys || !slot) throw new Error('This vault predates key slots; unlock it once to upgrade.')
    try {
      const check = await openPassphraseSlot(slot, passphrase, keys.kdf, keyfile)
      check.fill(0)
    } catch (e) {
      if (e instanceof BadCredentialsError) await this.fail(a, 're-entering the passphrase')
      throw e
    }
    await this.clearAttempts()
    return keys
  }

  /** Change the passphrase and/or keyfile. Rewraps the data key; the cases are not re-encrypted. */
  async changeCredentials(
    current: { passphrase: string; keyfile?: Buffer | null },
    next: { passphrase: string; keyfile?: Buffer | null }
  ): Promise<void> {
    if (next.passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`)
    const keys = await this.reauth(current.passphrase, current.keyfile)
    const slot = await makePassphraseSlot(this.dek as Buffer, next.passphrase, keys.kdf, next.keyfile)
    keys.slots = [slot, ...keys.slots.filter((s) => s.id !== 'passphrase')]
    await atomicWrite(this.p(KEYS), JSON.stringify(keys, null, 2))
    await this.audit('credentials:change', next.keyfile ? 'passphrase + keyfile' : 'passphrase')
  }

  /** Make a new recovery key. The old one stops working. */
  async newRecovery(passphrase: string, keyfile?: Buffer | null): Promise<SetupResult> {
    const keys = await this.reauth(passphrase, keyfile)
    const recovery = newRecoveryKey()
    keys.slots = [...keys.slots.filter((s) => s.id !== 'recovery'), makeRecoverySlot(this.dek as Buffer, recovery)]
    await atomicWrite(this.p(KEYS), JSON.stringify(keys, null, 2))
    await this.audit('recovery:new', 'the previous recovery key no longer works')
    return { recoveryKey: formatRecoveryKey(recovery) }
  }

  // ---- ending ----

  /** Crypto-erase: the wrapped keys are overwritten and removed, so the sealed cases cannot be opened by
   *  anyone, including the owner and including from a backup of the sealed file. The security log goes too. */
  async destroy(): Promise<void> {
    this.lock('destroy')
    await this.auditQueue
    for (const f of [KEYS, SEALED, `${SEALED}.bak`, `${SEALED}.v1.bak`, PLAIN, ATTEMPTS, IDENTITY, AUDIT]) await scrub(this.p(f))
  }

  // ---- agent identity ----

  private async readIdentity(): Promise<{ priv: string; pub: string; created: string } | null> {
    if (!this.dek) throw new VaultLockedError()
    try {
      return JSON.parse(decryptWithKey(await readFile(this.p(IDENTITY)), this.dek).toString('utf8'))
    } catch {
      return null
    }
  }

  /** This agent's signing identity, made the first time it is needed. The private key lives only inside the
   *  vault's encryption and never leaves this class. */
  async identity(): Promise<Identity> {
    const have = await this.readIdentity()
    if (have) return { publicKey: have.pub, fingerprint: fingerprintOf(have.pub), created: have.created }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const rec = {
      priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      pub: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      created: new Date(this.now()).toISOString()
    }
    const sealed = encryptWithKey(Buffer.from(JSON.stringify(rec), 'utf8'), this.dek as Buffer, { salt: randomBytes(16), ...DEFAULT_KDF })
    await atomicWrite(this.p(IDENTITY), sealed)
    await this.audit('identity:create', fingerprintOf(rec.pub))
    return { publicKey: rec.pub, fingerprint: fingerprintOf(rec.pub), created: rec.created }
  }

  /** Sign bytes with this agent's identity. Returns base64. */
  async sign(data: Buffer): Promise<{ signature: string; publicKey: string; fingerprint: string }> {
    const id = await this.identity()
    const rec = (await this.readIdentity())!
    const key = createPrivateKey({ key: Buffer.from(rec.priv, 'base64'), format: 'der', type: 'pkcs8' })
    return { signature: edSign(null, data, key).toString('base64'), publicKey: id.publicKey, fingerprint: id.fingerprint }
  }

  /** The sealed vault bytes, for a backup. Useless without the keys file and a credential. The identity is
   *  encrypted under the same data key, so it travels with the backup and is just as protected. */
  async backupBytes(): Promise<{ vault: Buffer; keys: Buffer; identity?: Buffer }> {
    if (!this.dek) throw new VaultLockedError()
    const identity = existsSync(this.p(IDENTITY)) ? await readFile(this.p(IDENTITY)) : undefined
    return { vault: await readFile(this.p(SEALED)), keys: await readFile(this.p(KEYS)), ...(identity && { identity }) }
  }

  /** Replace this vault with a backup. Allowed only when there is nothing to lose (no vault yet) or the
   *  person has already proved who they are by unlocking the current one. The vault is left locked: the
   *  backup opens with the credentials it had when it was made, not the ones in use now. */
  async restore(parts: { vault: Buffer; keys: Buffer; identity?: Buffer }): Promise<void> {
    const sealed = existsSync(this.p(SEALED)) || existsSync(this.p(KEYS))
    if (sealed && !this.dek) throw new VaultLockedError()
    if (!sealed && existsSync(this.p(PLAIN))) throw new Error('Cases are stored unprotected on this computer. Set up the vault first so they are not overwritten.')
    await atomicWrite(this.p(SEALED), parts.vault)
    await atomicWrite(this.p(KEYS), parts.keys)
    if (parts.identity) await atomicWrite(this.p(IDENTITY), parts.identity)
    else await scrub(this.p(IDENTITY)) // the old one is encrypted under a key that no longer exists
    for (const f of [`${SEALED}.bak`, `${SEALED}.v1.bak`, ATTEMPTS]) await scrub(this.p(f))
    this.lock('restore')
    await this.audit('backup:restore', 'vault replaced from a backup')
  }
}
