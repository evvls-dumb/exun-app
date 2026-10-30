// What to tell the person about a signed case file, given who they have met before.
import type { SignatureCheck } from './intake'
import type { SignerRecord } from './investigation'

export type SignerKind = 'unsigned' | 'invalid' | 'trusted' | 'known' | 'new' | 'changed'

export interface SignerVerdict {
  kind: SignerKind
  headline: string
  detail: string
  /** The person should look at this before merging. */
  warn: boolean
}

/** `claimed` is the callsign the file says it is from. A valid signature proves the file is unchanged since it was
 *  signed by that key; whether the key belongs to the person it says it does is only settled by comparing the
 *  fingerprint outside Janus, which is what "trusted" records. */
export function judgeSigner(check: SignatureCheck | undefined, claimed: string | undefined, signers: Record<string, SignerRecord>): SignerVerdict {
  if (!check || check.state === 'unsigned') {
    return { kind: 'unsigned', warn: false, headline: 'Not signed', detail: 'Nothing proves who made this file or that it is unchanged since. Hashes inside it can still be re-checked.' }
  }
  if (check.state === 'invalid') {
    return { kind: 'invalid', warn: true, headline: 'Signature does not match', detail: 'The file was altered after it was signed, or the signature was forged. Do not rely on it.' }
  }
  const fp = check.fingerprint!
  const rec = signers[fp]
  if (rec?.trusted) return { kind: 'trusted', warn: false, headline: `Signed by ${rec.agent}, whom you trust`, detail: `Fingerprint ${fp}. Unchanged since it was signed.` }
  if (rec) return { kind: 'known', warn: false, headline: `Signed by ${rec.agent}, seen before`, detail: `Fingerprint ${fp}. Unchanged since signed. You have not confirmed this fingerprint with them.` }
  const other = Object.entries(signers).find(([, r]) => r.trusted && !!claimed && r.agent.toLowerCase() === claimed.toLowerCase())
  if (other) {
    return {
      kind: 'changed',
      warn: true,
      headline: `Says it is from ${claimed}, but the key is not theirs`,
      detail: `You trust ${other[1].agent} under fingerprint ${other[0]}. This file is signed with ${fp}. Either they have a new identity or someone is using their name. Check with them first.`
    }
  }
  return { kind: 'new', warn: false, headline: `Signed by ${claimed ?? check.signer ?? 'an unknown agent'}, first time seen`, detail: `Fingerprint ${fp}. Unchanged since signed. Compare this fingerprint with the sender by phone or in person before trusting the name.` }
}
