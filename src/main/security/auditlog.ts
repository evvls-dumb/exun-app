// A security event log kept next to the vault: setups, unlocks, wrong guesses, locks, credential changes, restores.
//
// Each entry carries the hash of the one before it, so editing or reordering an entry in the middle is detected.
// That is all it promises. It is not secret (it has to be writable while the vault is locked, which is when guesses
// happen), and someone with the disk can truncate it or rewrite the whole chain. Its value is to the owner: it shows,
// for example, that twelve wrong passphrases were tried at 3 a.m.
//
// No Electron imports.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { sha256 } from '../../shared/sha256'

export interface AuditEntry {
  seq: number
  time: string
  event: string
  detail: string
  prev: string
  hash: string
}

export interface AuditReport {
  entries: AuditEntry[]
  /** The hashes line up from the first entry kept to the last. */
  intact: boolean
  /** The sequence number of the first entry that does not match, when not intact. */
  brokenAt?: number
  /** Older entries were dropped to bound the file; the chain is checked from the oldest one kept. */
  earlierDropped: boolean
}

const KEEP = 1000
const hashOf = (prev: string, seq: number, time: string, event: string, detail: string) => sha256(`${prev}|${seq}|${time}|${event}|${detail}`)

function parse(text: string): AuditEntry[] {
  const out: AuditEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as AuditEntry
      if (typeof e.seq === 'number' && typeof e.hash === 'string') out.push(e)
    } catch {
      // a damaged line is reported by the chain check below, not silently dropped: keep a placeholder
      out.push({ seq: -1, time: '', event: 'unreadable', detail: '', prev: '', hash: '' })
    }
  }
  return out
}

export async function readAudit(path: string): Promise<AuditReport> {
  let entries: AuditEntry[] = []
  try {
    entries = parse(await readFile(path, 'utf8'))
  } catch {
    // no log yet
  }
  let prev: string | null = null
  for (const e of entries) {
    const bad = e.seq < 0 || (prev !== null && e.prev !== prev) || hashOf(e.prev, e.seq, e.time, e.event, e.detail) !== e.hash
    if (bad) return { entries, intact: false, brokenAt: e.seq, earlierDropped: entries[0]?.seq > 0 }
    prev = e.hash
  }
  return { entries, intact: true, earlierDropped: entries.length > 0 && entries[0].seq > 0 }
}

/** Append one entry. Callers must not run two appends at once; the vault serialises them. */
export async function appendAudit(path: string, event: string, detail: string, time: string): Promise<void> {
  let entries: AuditEntry[] = []
  try {
    entries = parse(await readFile(path, 'utf8'))
  } catch {
    // first entry
  }
  const last = entries[entries.length - 1]
  const seq = last && last.seq >= 0 ? last.seq + 1 : 0
  const prev = last && last.seq >= 0 ? last.hash : 'genesis'
  entries.push({ seq, time, event, detail, prev, hash: hashOf(prev, seq, time, event, detail) })
  if (entries.length > KEEP + 200) entries = entries.slice(-KEEP)
  const tmp = `${path}.tmp`
  await writeFile(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  await rename(tmp, path)
}
