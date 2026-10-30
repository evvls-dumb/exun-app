// The field unit → platform handoff.
//
// The Game Boy field unit (janus-extract) writes every capture into a sealed acquisition folder: a
// manifest.json with a SHA-256 per file and a hash-chained log, and a `--ndjson` stream of the same
// facts. This turns any of those forms into a draft piece of evidence, already graded by what the seal
// proves. It is deliberately forgiving about the input shape, because an agent in the field will paste
// whatever they have: the whole NDJSON run, the manifest, or just the chain head the unit printed.
//
// Pure and side-effect free, so both the renderer (paste box) and the main process (file import) use it.

import type { Evidence, EvidenceFactors } from './evidence'

const CHAIN_HEAD = /\b[0-9a-f]{64}\b/i

export interface FieldUnitSummary {
  chainHead: string | null
  target: string | null // e.g. "raspberry-pi arcade-pi" or a serial device
  kind: string | null // "raspberry-pi" | "board"
  itemCount: number | null
  warnings: number | null
  createdAt: string | null // ISO, when the capture was taken
  verified: boolean | null // whether the unit reported the folder as verifying
}

export interface FieldUnitParse {
  ok: boolean
  summary: FieldUnitSummary
  /** A draft evidence item ready to submit, missing only investigationId/agentId/id. */
  draft?: Omit<Evidence, 'id' | 'investigationId' | 'agentId'>
  error?: string
  note: string // one line for the UI about what was read and how trustworthy it is
}

function emptySummary(): FieldUnitSummary {
  return {
    chainHead: null,
    target: null,
    kind: null,
    itemCount: null,
    warnings: null,
    createdAt: null,
    verified: null
  }
}

function targetString(target: unknown): { kind: string | null; text: string | null } {
  if (!target || typeof target !== 'object') return { kind: null, text: null }
  const record = target as Record<string, unknown>
  const kind = typeof record['kind'] === 'string' ? (record['kind'] as string) : null
  const address = typeof record['address'] === 'string' ? (record['address'] as string) : null
  const text = [kind, address].filter(Boolean).join(' ').trim() || null
  return { kind, text }
}

/** Pull what we can from a parsed manifest.json object (or the `acquisition`/`done` NDJSON events). */
function readManifestLike(manifest: Record<string, unknown>, summary: FieldUnitSummary): void {
  const { kind, text } = targetString(manifest['target'])
  if (kind) summary.kind = kind
  if (text) summary.target = text
  if (typeof manifest['chain_head'] === 'string' && CHAIN_HEAD.test(manifest['chain_head'] as string)) {
    summary.chainHead = (manifest['chain_head'] as string).toLowerCase()
  }
  if (Array.isArray(manifest['items'])) summary.itemCount = (manifest['items'] as unknown[]).length
  else if (typeof manifest['items'] === 'number') summary.itemCount = manifest['items'] as number
  if (Array.isArray(manifest['warnings'])) summary.warnings = (manifest['warnings'] as unknown[]).length
  else if (typeof manifest['warnings'] === 'number') summary.warnings = manifest['warnings'] as number
  if (typeof manifest['created'] === 'string') summary.createdAt = manifest['created'] as string
  if (typeof manifest['verified'] === 'boolean') summary.verified = manifest['verified'] as boolean
}

function parseNdjson(text: string, summary: FieldUnitSummary): boolean {
  let sawEvent = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '{') continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const kind = event['event']
    if (kind === 'acquisition' || kind === 'done') {
      sawEvent = true
      readManifestLike(event, summary)
    }
  }
  return sawEvent
}

/**
 * Read a field-unit acquisition in whatever form it was pasted or loaded.
 * Order of attempts: a JSON object (manifest.json), then NDJSON events, then a bare chain head.
 */
export function parseFieldUnitAcquisition(raw: string): FieldUnitParse {
  const text = (raw ?? '').trim()
  const summary = emptySummary()
  if (!text) {
    return { ok: false, summary, error: 'Nothing pasted.', note: 'Paste the field unit output, or a manifest.json.' }
  }

  // 1. A whole manifest.json (or any single JSON object that looks like one).
  if (text[0] === '{') {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      readManifestLike(parsed, summary)
    } catch {
      // not a single object, fall through to NDJSON, which handles multi-line
    }
  }

  // 2. NDJSON events from `--ndjson` (fills anything the object step missed).
  if (!summary.chainHead || summary.itemCount === null) {
    parseNdjson(text, summary)
  }

  // 3. Last resort: a bare chain head somewhere in the text.
  if (!summary.chainHead) {
    const match = text.match(CHAIN_HEAD)
    if (match) summary.chainHead = match[0].toLowerCase()
  }

  if (!summary.chainHead && summary.itemCount === null) {
    return {
      ok: false,
      summary,
      error: 'No chain head or manifest found in that text.',
      note: 'Expected a 64-character seal, a manifest.json, or the field unit’s --ndjson output.'
    }
  }

  // Pasted text is the field unit's account of a capture, not the capture. A chain head by itself proves
  // nothing to the platform: it is a claim until the acquisition folder is dropped in and every hash is
  // recomputed. So the claim is recorded, but it earns no seal and no custody here.
  const claimed = summary.chainHead !== null
  const factors: EvidenceFactors = {
    sealed: false,
    custody: false,
    firsthand: true, // the unit captured it directly off the machine
    timestamped: summary.createdAt !== null
  }

  const where = summary.target ?? (summary.kind === 'board' ? 'serial board' : 'Raspberry Pi')
  const verification = {
    state: 'unchecked' as const,
    notes: [
      claimed
        ? 'A chain head was supplied but the acquisition itself was not, so nothing could be recomputed. This is a claim, not a verified seal.'
        : 'No chain head was found, so there is nothing to verify.',
      'Drop the acquisition folder or its .tar.gz pack to verify it and earn the seal.'
    ]
  }
  const draft: Omit<Evidence, 'id' | 'investigationId' | 'agentId'> = {
    title: `Field-unit acquisition (claimed): ${where}`,
    type: 'acquisition',
    source: `Janus field unit · ${where}`,
    notes: claimed
      ? `Claimed seal, not verified. Chain head ${summary.chainHead?.slice(0, 16)}… · ${summary.itemCount ?? '?'} items${
          summary.warnings ? ` · ${summary.warnings} warnings` : ''
        }.`
      : 'Imported from the field unit without a seal, treat as a claim until re-collected.',
    stance: 'neutral',
    strength: 1,
    factors,
    chainHead: summary.chainHead ?? undefined,
    itemCount: summary.itemCount ?? undefined,
    occurredAt: summary.createdAt ?? undefined,
    addedAt: new Date().toISOString(),
    origin: 'fieldunit',
    verification,
    findings: [{ severity: 'medium', title: 'Seal not verified', detail: verification.notes.join(' ') }]
  }

  const note = claimed
    ? `Read a claimed seal (${summary.itemCount ?? '?'} items). It is recorded, but Janus has not verified it: drop the acquisition folder to do that.`
    : `Read the acquisition, but found no chain head, so it is not tamper-evident. Re-import the sealed folder to grade it higher.`

  return { ok: true, summary, draft, note }
}
