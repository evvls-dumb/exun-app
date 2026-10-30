// The field unit's acquisition manifest (manifest.json, schema janus.acquisition/1) and its custody
// chain, read here exactly as `janus verify` reads them so a seal checked in the platform means the same
// thing as a seal checked on the handheld.
//
// Each log entry carries h = sha256(q|s|t|a|p), where q is the previous entry's h ("genesis" for the
// first). Changing, removing or reordering an entry breaks every hash after it. This detects edits; it
// cannot say who made them, and someone who rewrites the files AND the whole manifest consistently can
// pass it. That is why the field unit tells the operator to write the chain head down somewhere else,
// and why the platform lets an agent enter that recorded head and compares it.

export const ACQUISITION_SCHEMA = 'janus.acquisition/1'

export interface AcqLogEntry {
  s: number
  t: string
  a: string
  p: string
  q: string
  h: string
}

export interface AcqItem {
  path: string
  kind: string
  sha256: string
  bytes: number
  acquired_at: string
  source?: string | null
  note?: string | null
  derived_from?: string | null
}

export interface AcqManifest {
  schema: string
  tool: { name: string; version: string }
  created: string
  examiner?: string | null
  case?: string | null
  note?: string | null
  target: { kind?: string; address?: string }
  host: { hostname?: string; platform?: string; node?: string }
  items: AcqItem[]
  warnings: string[]
  log: AcqLogEntry[]
  chain_head: string | null
}

export function parseManifest(text: string): AcqManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const m = parsed as Partial<AcqManifest>
  if (m.schema !== ACQUISITION_SCHEMA || !Array.isArray(m.items) || !Array.isArray(m.log)) return null
  return {
    schema: m.schema,
    tool: m.tool ?? { name: 'unknown', version: '?' },
    created: m.created ?? '',
    examiner: m.examiner ?? null,
    case: m.case ?? null,
    note: m.note ?? null,
    target: m.target ?? {},
    host: m.host ?? {},
    items: m.items as AcqItem[],
    warnings: Array.isArray(m.warnings) ? (m.warnings as string[]) : [],
    log: m.log as AcqLogEntry[],
    chain_head: m.chain_head ?? null
  }
}

export interface ChainResult {
  ok: boolean
  entries: number
  /** Sequence number of the first entry that does not verify. */
  brokenAt?: number
  reason?: string
}

/** Recompute the hash chain. `hash` is sha256 of a UTF-8 string, hex. */
export function verifyAcquisitionChain(
  log: readonly AcqLogEntry[],
  chainHead: string | null,
  hash: (message: string) => string
): ChainResult {
  let q = 'genesis'
  for (const e of log) {
    if (e.q !== q) return { ok: false, entries: log.length, brokenAt: e.s, reason: `entry #${e.s} does not follow the one before it` }
    if (hash(`${q}|${e.s}|${e.t}|${e.a}|${e.p}`) !== e.h) {
      return { ok: false, entries: log.length, brokenAt: e.s, reason: `entry #${e.s} (${e.a}) was altered` }
    }
    q = e.h
  }
  const last = log.length > 0 ? log[log.length - 1].h : null
  if (last !== chainHead) {
    return { ok: false, entries: log.length, reason: 'chain_head does not match the last log entry' }
  }
  return { ok: true, entries: log.length }
}

/** The log entry the field unit writes for an item; its presence ties the file to the chain. */
export function itemLogLine(item: Pick<AcqItem, 'path' | 'sha256' | 'bytes'>): string {
  return `${item.path} sha256 ${item.sha256} bytes ${item.bytes}`
}

/** "I_A" reported no value in 4 samples (nan). It was not measured; it is not zero. */
export function unmeasuredFromWarnings(warnings: readonly string[]): string[] {
  const out = new Set<string>()
  for (const w of warnings) {
    const m = /^"([^"]+)" reported no value/.exec(w)
    if (m) out.add(m[1])
  }
  return [...out]
}
