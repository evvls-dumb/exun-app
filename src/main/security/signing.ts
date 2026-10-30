// Ed25519 signatures for case files. An agent's identity is a key pair; the private half never leaves the vault
// (see CaseVault.sign), and the public half is shown as a short fingerprint two agents can compare by voice or in person.
//
// A signature proves that the file was not changed after it was signed and that whoever holds that private key signed
// it. It does not prove who that person is: that comes from comparing the fingerprint outside Janus. No Electron imports.
import { createHash, createPublicKey, verify } from 'node:crypto'

/** Short, spoken-friendly form of a public key: 8 groups of 4 hex characters (128 bits of the SHA-256). */
export function fingerprintOf(publicKeySpkiB64: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKeySpkiB64, 'base64')).digest('hex').slice(0, 32).toUpperCase()
  return hex.match(/.{4}/g)!.join('-')
}

export function verifySignature(publicKeySpkiB64: string, data: Buffer, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeySpkiB64, 'base64'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, data, key, Buffer.from(signatureB64, 'base64'))
  } catch {
    return false
  }
}

// ---- case files ----------------------------------------------------------------------------------

import type { CaseFile, CaseSignature } from '../../shared/investigation'
import type { SignatureCheck } from '../../shared/intake'

/** The exact bytes that are signed: the file without its signature, plus when and by whom it was signed. */
export function signedPayload(file: Omit<CaseFile, 'signature'>, signedAt: string, signer: string): Buffer {
  return Buffer.from(JSON.stringify({ file, signedAt, signer }), 'utf8')
}

export async function signCaseFile(
  file: CaseFile,
  signer: string,
  now: string,
  sign: (data: Buffer) => Promise<{ signature: string; publicKey: string; fingerprint: string }>
): Promise<CaseFile> {
  const { signature: _old, ...bare } = file
  const r = await sign(signedPayload(bare, now, signer))
  const signature: CaseSignature = { alg: 'ed25519', publicKey: r.publicKey, fingerprint: r.fingerprint, signature: r.signature, signedAt: now, signer }
  return { ...bare, signature }
}

export function verifyCaseFile(file: CaseFile): SignatureCheck {
  const s = file.signature
  if (!s) return { state: 'unsigned' }
  if (s.alg !== 'ed25519' || typeof s.publicKey !== 'string' || typeof s.signature !== 'string') return { state: 'invalid' }
  const { signature: _drop, ...bare } = file
  let fingerprint: string
  try {
    fingerprint = fingerprintOf(s.publicKey)
  } catch {
    return { state: 'invalid' }
  }
  const ok = verifySignature(s.publicKey, signedPayload(bare, s.signedAt, s.signer), s.signature)
  return ok ? { state: 'valid', fingerprint, signer: s.signer, signedAt: s.signedAt } : { state: 'invalid', fingerprint }
}
