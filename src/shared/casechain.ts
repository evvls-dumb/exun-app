// A hash-chained audit log for one investigation. Every action (evidence added, rated, report sent,
// case imported) is sealed with the hash of the entry before it, the same tamper-evident idea the field
// unit uses on its acquisitions, now applied to the investigation itself. Editing or reordering any past
// entry breaks the chain, and `verifyChain` finds where.
import { sha256 } from './sha256'

export interface CaseLogEntry {
  seq: number
  time: string
  actor: string
  action: string
  detail: string
  prev: string
  hash: string
}

function hashOf(prev: string, seq: number, time: string, actor: string, action: string, detail: string): string {
  return sha256(`${prev}|${seq}|${time}|${actor}|${action}|${detail}`)
}

export function appendEntry(
  log: readonly CaseLogEntry[],
  entry: { actor: string; action: string; detail: string },
  time: string = new Date().toISOString()
): CaseLogEntry[] {
  const prev = log.length ? log[log.length - 1].hash : 'genesis'
  const seq = log.length
  return [...log, { seq, time, actor: entry.actor, action: entry.action, detail: entry.detail, prev, hash: hashOf(prev, seq, time, entry.actor, entry.action, entry.detail) }]
}

export function verifyChain(log: readonly CaseLogEntry[]): { ok: boolean; at?: number } {
  let prev = 'genesis'
  for (const e of log) {
    if (e.prev !== prev || hashOf(prev, e.seq, e.time, e.actor, e.action, e.detail) !== e.hash) {
      return { ok: false, at: e.seq }
    }
    prev = e.hash
  }
  return { ok: true }
}

export function chainHead(log: readonly CaseLogEntry[]): string | null {
  return log.length ? log[log.length - 1].hash : null
}
