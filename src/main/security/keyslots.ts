// Key hierarchy for the case vault.
//
//   data key (DEK)      random 256 bits, generated once; encrypts the vault (AES-256-GCM)
//   passphrase slot     DEK wrapped under KEK = scrypt(passphrase [+ keyfile])
//   recovery slot       DEK wrapped under a random 256-bit recovery key shown once at setup
//
// Because the vault is encrypted under the data key and not under the passphrase, changing the passphrase
// rewraps 32 bytes instead of re-encrypting everything, a recovery key can exist without weakening the
// passphrase, and a second factor (a keyfile) can be mixed into the passphrase slot.
//
// Nothing here touches Electron or the disk, so it is tested in plain Node.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb } from 'node:crypto'

export interface SlotKdf {
  logN: number
  r: number
  p: number
}

/** 2^17 = 128 MiB of memory per guess: much slower to brute-force than the 32 MiB used for single files. */
export const SLOT_KDF: SlotKdf = { logN: 17, r: 8, p: 1 }

export interface Slot {
  id: 'passphrase' | 'recovery'
  /** base64 */
  salt: string
  /** base64 of iv(12) | ciphertext(32) | tag(16) */
  wrapped: string
  /** The passphrase slot only: a keyfile is required to open it. */
  keyfile?: boolean
}

export class BadCredentialsError extends Error {
  constructor(message = 'Wrong passphrase, keyfile or recovery key.') {
    super(message)
    this.name = 'BadCredentialsError'
  }
}

/** Not a wrong guess: the person has not supplied the keyfile yet, so it is not counted against them. */
export class KeyfileRequiredError extends Error {
  constructor() {
    super('This vault also needs its keyfile.')
    this.name = 'KeyfileRequiredError'
  }
}

const norm = (s: string) => Buffer.from(s.normalize('NFKC'), 'utf8')

function scryptAsync(secret: Buffer, salt: Buffer, k: SlotKdf): Promise<Buffer> {
  const N = 2 ** k.logN
  return new Promise((resolve, reject) =>
    scryptCb(secret, salt, 32, { N, r: k.r, p: k.p, maxmem: 128 * N * k.r * 2 + 8 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key)))
  )
}

/** The key-encrypting key for the passphrase slot. A keyfile is mixed in with HMAC so that neither factor
 *  alone yields it. */
export async function passphraseKek(passphrase: string, salt: Buffer, kdf: SlotKdf, keyfile?: Buffer | null): Promise<Buffer> {
  const stretched = await scryptAsync(norm(passphrase), salt, kdf)
  if (!keyfile) return stretched
  return createHmac('sha256', stretched).update(createHash('sha256').update(keyfile).digest()).update('janus-keyfile-v1').digest()
}

export function recoveryKek(recoveryKey: Buffer): Buffer {
  return createHmac('sha256', recoveryKey).update('janus-recovery-v1').digest()
}

function wrap(kek: Buffer, dek: Buffer, id: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', kek, iv)
  c.setAAD(Buffer.from(`janus-slot-v2:${id}`))
  const body = Buffer.concat([c.update(dek), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64')
}

function unwrap(kek: Buffer, wrapped: string, id: string): Buffer {
  const b = Buffer.from(wrapped, 'base64')
  if (b.length !== 12 + 32 + 16) throw new BadCredentialsError('The key file is damaged.')
  try {
    const d = createDecipheriv('aes-256-gcm', kek, b.subarray(0, 12))
    d.setAAD(Buffer.from(`janus-slot-v2:${id}`))
    d.setAuthTag(b.subarray(b.length - 16))
    return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()])
  } catch {
    throw new BadCredentialsError()
  }
}

export async function makePassphraseSlot(dek: Buffer, passphrase: string, kdf: SlotKdf, keyfile?: Buffer | null): Promise<Slot> {
  const salt = randomBytes(16)
  const kek = await passphraseKek(passphrase, salt, kdf, keyfile)
  const slot: Slot = { id: 'passphrase', salt: salt.toString('base64'), wrapped: wrap(kek, dek, 'passphrase') }
  if (keyfile) slot.keyfile = true
  kek.fill(0)
  return slot
}

export function makeRecoverySlot(dek: Buffer, recoveryKey: Buffer): Slot {
  const salt = randomBytes(16)
  return { id: 'recovery', salt: salt.toString('base64'), wrapped: wrap(recoveryKek(recoveryKey), dek, 'recovery') }
}

export async function openPassphraseSlot(slot: Slot, passphrase: string, kdf: SlotKdf, keyfile?: Buffer | null): Promise<Buffer> {
  if (slot.keyfile && !keyfile) throw new KeyfileRequiredError()
  const kek = await passphraseKek(passphrase, Buffer.from(slot.salt, 'base64'), kdf, slot.keyfile ? keyfile : null)
  try {
    return unwrap(kek, slot.wrapped, 'passphrase')
  } finally {
    kek.fill(0)
  }
}

export function openRecoverySlot(slot: Slot, recoveryKey: Buffer): Buffer {
  const kek = recoveryKek(recoveryKey)
  try {
    return unwrap(kek, slot.wrapped, 'recovery')
  } finally {
    kek.fill(0)
  }
}

// ---- recovery key text -------------------------------------------------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function newRecoveryKey(): Buffer {
  return randomBytes(32)
}

/** 32 bytes as 13 groups of 4 base32 characters (52 characters; the last group carries 4 padding bits). */
export function formatRecoveryKey(key: Buffer): string {
  let bits = ''
  for (const b of key) bits += b.toString(2).padStart(8, '0')
  bits = bits.padEnd(260, '0')
  let out = ''
  for (let i = 0; i < 260; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out.match(/.{4}/g)!.join('-')
}

export function parseRecoveryKey(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B')
  if (clean.length !== 52 || [...clean].some((c) => !B32.includes(c))) throw new BadCredentialsError('That is not a recovery key (it has 52 letters and digits in groups of four).')
  let bits = ''
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, '0')
  const bytes = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return bytes
}

// ---- attempt throttling ------------------------------------------------------------------------------

/** Delay before the next try is allowed, after `fails` consecutive wrong attempts: none for the first
 *  three, then 1 s, 2 s, 4 s … capped at 15 minutes. */
export function throttleMs(fails: number): number {
  if (fails < 4) return 0
  return Math.min(2 ** (fails - 4) * 1000, 15 * 60 * 1000)
}

export class ThrottledError extends Error {
  constructor(readonly waitMs: number) {
    super(`Too many wrong attempts. Wait ${Math.ceil(waitMs / 1000)} s before trying again.`)
    this.name = 'ThrottledError'
  }
}

export { passphraseStrength, type Strength } from '../../shared/passphrase'
