// The sealed container: how Janus encrypts a case vault at rest and how a field-unit pack or a case file
// is protected in transit. One small, documented format, so the field unit's CLI (lib/seal.js) and this
// module read each other's files.
//
//   "JANUSENC" | version(1) | kdf(1 = scrypt) | log2N | r | p | salt(16) | iv(12) | ciphertext | tag(16)
//
// AES-256-GCM, with the whole header authenticated as associated data, so changing the cost parameters
// or the salt is detected the same way as changing the contents. The key comes from a passphrase through
// scrypt (N = 2^15, r = 8, p = 1 by default: about 32 MiB and under a second on a laptop). There is no
// recovery: a lost passphrase means the contents cannot be read, by anyone, including Janus.
//
// No Electron imports here, so it runs and is tested in plain Node.

import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, scryptSync } from 'node:crypto'

const MAGIC = Buffer.from('JANUSENC', 'ascii')
const VERSION = 1
const KDF_SCRYPT = 1
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + 1 + 1 + 1 + 1 + 1 + SALT_BYTES + IV_BYTES

export const MIN_PASSPHRASE = 8

export interface KdfParams {
  logN: number
  r: number
  p: number
}

export const DEFAULT_KDF: KdfParams = { logN: 15, r: 8, p: 1 }

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase, or the file has been altered.')
    this.name = 'WrongPassphraseError'
  }
}

export class NotSealedError extends Error {
  constructor() {
    super('That is not a Janus sealed file.')
    this.name = 'NotSealedError'
  }
}

export interface SealHeader extends KdfParams {
  salt: Buffer
  iv: Buffer
}

export function isSealed(data: Uint8Array): boolean {
  return data.length >= HEADER_BYTES + TAG_BYTES && Buffer.from(data.subarray(0, MAGIC.length)).equals(MAGIC)
}

export function readHeader(data: Uint8Array): SealHeader {
  if (!isSealed(data)) throw new NotSealedError()
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  let o = MAGIC.length
  const version = buf[o++]
  const kdf = buf[o++]
  if (version !== VERSION || kdf !== KDF_SCRYPT) throw new Error('This sealed file uses a format this version of Janus cannot read.')
  const logN = buf[o++]
  const r = buf[o++]
  const p = buf[o++]
  if (logN < 10 || logN > 22 || r < 1 || r > 32 || p < 1 || p > 8) throw new Error('The sealed file has invalid key-derivation settings.')
  const salt = buf.subarray(o, o + SALT_BYTES)
  o += SALT_BYTES
  const iv = buf.subarray(o, o + IV_BYTES)
  return { logN, r, p, salt: Buffer.from(salt), iv: Buffer.from(iv) }
}

function normalise(passphrase: string): Buffer {
  return Buffer.from(passphrase.normalize('NFKC'), 'utf8')
}

function scryptOptions(params: KdfParams): { N: number; r: number; p: number; maxmem: number } {
  const N = 2 ** params.logN
  return { N, r: params.r, p: params.p, maxmem: 128 * N * params.r * 2 + 4 * 1024 * 1024 }
}

export function deriveKey(passphrase: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Buffer {
  return scryptSync(normalise(passphrase), salt, 32, scryptOptions(params))
}

/** Same derivation without blocking the main process, for use when a person is waiting on a button. */
export function deriveKeyAsync(passphrase: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(normalise(passphrase), salt, 32, scryptOptions(params), (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

function buildHeader(params: KdfParams, salt: Uint8Array, iv: Uint8Array): Buffer {
  return Buffer.concat([
    MAGIC,
    Buffer.from([VERSION, KDF_SCRYPT, params.logN, params.r, params.p]),
    Buffer.from(salt),
    Buffer.from(iv)
  ])
}

/** Encrypt with an already-derived key. A fresh IV is used on every call, so the same key can be reused
 *  for each save of a vault without ever repeating an (key, IV) pair. */
export function encryptWithKey(
  plain: Uint8Array,
  key: Buffer,
  context: { salt: Uint8Array } & KdfParams
): Buffer {
  const iv = randomBytes(IV_BYTES)
  const header = buildHeader(context, context.salt, iv)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([header, body, cipher.getAuthTag()])
}

export function decryptWithKey(data: Uint8Array, key: Buffer): Buffer {
  const header = readHeader(data)
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const aad = buf.subarray(0, HEADER_BYTES)
  const tag = buf.subarray(buf.length - TAG_BYTES)
  const body = buf.subarray(HEADER_BYTES, buf.length - TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, header.iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    throw new WrongPassphraseError()
  }
}

export function sealBuffer(plain: Uint8Array, passphrase: string, params: KdfParams = DEFAULT_KDF): Buffer {
  const salt = randomBytes(SALT_BYTES)
  return encryptWithKey(plain, deriveKey(passphrase, salt, params), { salt, ...params })
}

export function openBuffer(data: Uint8Array, passphrase: string): Buffer {
  const header = readHeader(data)
  return decryptWithKey(data, deriveKey(passphrase, header.salt, header))
}

export async function openBufferAsync(data: Uint8Array, passphrase: string): Promise<Buffer> {
  const header = readHeader(data)
  return decryptWithKey(data, await deriveKeyAsync(passphrase, header.salt, header))
}
