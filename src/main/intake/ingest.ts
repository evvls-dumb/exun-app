// Intake: turn whatever an agent drops (folders, packs, loose files, sealed files) into reviewed,
// analysed, hashed candidates for evidence.
//
// The rule that matters most: Janus does not trust a seal it has not recomputed. A field-unit
// acquisition counts as sealed only when its hash chain verifies AND every file in it, re-read here,
// matches the hash the field unit logged. A file that was edited after capture, or a manifest that was
// altered, is reported as a broken seal and graded accordingly. A manifest handed over without its files
// is a claim, not a seal.
//
// Everything is read-only. Nothing is executed, and nothing outside the dropped paths is touched.

import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { posix } from 'node:path'
import {
  ACQUISITION_SCHEMA,
  itemLogLine,
  parseManifest,
  unmeasuredFromWarnings,
  verifyAcquisitionChain,
  type AcqManifest
} from '../../shared/acquisition'
import { verifyChain } from '../../shared/casechain'
import { readLedger, analyseLedger } from '../../shared/ledger'
import { analyseDiff, looksLikeDiff } from '../../shared/diffanalysis'
import type { EvidenceFactors, EvidenceFacts, Finding, Verification } from '../../shared/evidence'
import { parseFieldUnitAcquisition } from '../../shared/fieldunit'
import type { AcquisitionSummary, EvidenceDraft, IntakeBatch, IntakeItem } from '../../shared/intake'
import { CASE_FILE_SCHEMA, type CaseFile } from '../../shared/investigation'
import { verifyCaseFile } from '../security/signing'
import { analyseJanusLog, looksLikeJanusLog, parseJanusLog } from '../../shared/januslog'
import { analyseReadings, looksLikeReadings } from '../../shared/readings'
import { describeCounts, scanForIdentifiers } from '../../shared/redact'
import { WrongPassphraseError, isSealed, openBufferAsync } from '../security/seal'
import { gunzip, isGzip, looksLikeTar, readTar } from './tar'
import { diskVfs, memoryVfs, MAX_FILE_BYTES, type Vfs } from './vfs'

const MAX_TEXT_BYTES = 64 * 1024 * 1024
/** Text that reads as a person's words rather than as code or configuration. */
const DOC_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.rtf', '.log', '.eml', '.text', '.notes'])
const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.kt', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp',
  '.go', '.rs', '.rb', '.php', '.lua', '.sh', '.cmd', '.bat', '.ps1', '.html', '.css', '.sql', '.class'
])
const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

export interface IngestOptions {
  /** Passphrase for sealed files. */
  passphrase?: string
  /** Today as YYYY-MM-DD, for date checks. Passed in so tests are deterministic. */
  today?: string
}

interface Inherit {
  factors?: Partial<EvidenceFactors>
  parent?: string
  group?: string
  label?: string
  verification?: Verification
}

class Ctx {
  items: IntakeItem[] = []
  skipped: IntakeBatch['skipped'] = []
  private seq = 0
  /** Analysed files by content hash, so the same logs.janus in three captures becomes one item. */
  byHash = new Map<string, IntakeItem>()
  constructor(readonly options: IngestOptions) {}
  key(): string {
    return `k${++this.seq}`
  }
  get today(): string {
    return this.options.today ?? new Date().toISOString().slice(0, 10)
  }
  push(item: IntakeItem): IntakeItem {
    this.items.push(item)
    return item
  }
}

// ---- public entry ---------------------------------------------------------------------------------

export async function ingestPaths(paths: string[], options: IngestOptions = {}): Promise<IntakeBatch> {
  const ctx = new Ctx(options)
  for (const path of paths) {
    try {
      await processPath(ctx, path)
    } catch (error) {
      ctx.skipped.push({ name: basename(path), reason: error instanceof Error ? error.message : 'could not be read' })
    }
  }
  return { items: ctx.items, skipped: ctx.skipped }
}

async function processPath(ctx: Ctx, path: string): Promise<void> {
  const info = await lstat(path)
  const name = basename(path)
  if (info.isSymbolicLink()) {
    ctx.skipped.push({ name, reason: 'symbolic link, not followed' })
  } else if (info.isDirectory()) {
    const vfs = await diskVfs(path, name)
    ctx.skipped.push(...vfs.skipped.map((s) => ({ name: `${name}/${s.name}`, reason: s.reason })))
    await processVfs(ctx, vfs)
  } else if (info.isFile()) {
    if (info.size > MAX_FILE_BYTES) {
      ctx.skipped.push({ name, reason: 'larger than 512 MB' })
      return
    }
    const buf = await readFile(path)
    await processBuffer(ctx, name, buf, path)
  }
}

async function processBuffer(ctx: Ctx, name: string, buf: Buffer, realPath?: string): Promise<void> {
  if (isSealed(buf)) {
    await processSealed(ctx, name, buf, realPath)
    return
  }
  if (isGzip(buf)) {
    let raw: Buffer | null = null
    try {
      raw = gunzip(buf)
    } catch {
      raw = null
    }
    if (raw && looksLikeTar(raw)) {
      const tar = readTar(raw)
      const label = name.replace(/\.(tar\.gz|tgz)$/i, '')
      const vfs = memoryVfs(label, tar.entries, tar.skipped)
      ctx.skipped.push(...tar.skipped.map((s) => ({ name: `${name}:${s.name}`, reason: s.reason })))
      const pack = { name, sha: sha(buf), note: await sidecarNote(realPath, sha(buf)) }
      await processVfs(ctx, vfs, pack)
      return
    }
  }
  await processLoose(ctx, name, buf)
}

/** `janus pack` writes <pack>.sha256 beside the archive. If it is there, check the pack against it. */
async function sidecarNote(realPath: string | undefined, digest: string): Promise<{ ok: boolean; text: string } | null> {
  if (!realPath) return null
  try {
    const text = await readFile(`${realPath}.sha256`, 'utf8')
    const recorded = /^[0-9a-f]{64}/i.exec(text.trim())?.[0]?.toLowerCase()
    if (!recorded) return null
    return recorded === digest
      ? { ok: true, text: 'The pack matches the SHA-256 recorded beside it.' }
      : { ok: false, text: `The pack's SHA-256 (${digest.slice(0, 12)}…) does not match the one recorded beside it (${recorded.slice(0, 12)}…). It changed after it was packed.` }
  } catch {
    return null
  }
}

async function processSealed(ctx: Ctx, name: string, buf: Buffer, realPath?: string): Promise<void> {
  const base: IntakeItem = {
    key: ctx.key(),
    name,
    kind: 'encrypted',
    bytes: buf.length,
    sha256: sha(buf),
    status: 'locked',
    summary: ['Sealed with a passphrase. Enter it to read the contents.'],
    findings: [],
    lockedPath: realPath
  }
  if (!ctx.options.passphrase) {
    ctx.push(base)
    return
  }
  try {
    const plain = await openBufferAsync(buf, ctx.options.passphrase)
    await processBuffer(ctx, name.replace(/\.(janus-enc|janus-sealed|enc)$/i, ''), plain)
  } catch (error) {
    ctx.push({
      ...base,
      summary: [error instanceof WrongPassphraseError ? 'That passphrase does not open this file, or the file was altered.' : (error as Error).message]
    })
  }
}

// ---- folders and packs ---------------------------------------------------------------------------

async function processVfs(ctx: Ctx, vfs: Vfs, pack?: { name: string; sha: string; note: { ok: boolean; text: string } | null }): Promise<void> {
  const byPath = new Map(vfs.files.map((f) => [f.path, f]))
  const roots: { dir: string; text: string; manifest: AcqManifest }[] = []
  for (const file of vfs.files) {
    if (basename(file.path).toLowerCase() !== 'manifest.json' || file.size > 20 * 1024 * 1024) continue
    const text = (await file.read()).toString('utf8')
    const manifest = parseManifest(text)
    if (manifest) roots.push({ dir: posix.dirname(file.path) === '.' ? '' : posix.dirname(file.path), text, manifest })
  }

  const consumed = new Set<string>()
  for (const root of roots) {
    const prefix = root.dir ? `${root.dir}/` : ''
    for (const f of vfs.files) if (f.path.startsWith(prefix)) consumed.add(f.path)
    await ingestAcquisition(ctx, vfs, byPath, root, pack)
  }

  for (const file of vfs.files) {
    if (consumed.has(file.path)) continue
    await processLoose(ctx, `${vfs.label}/${file.path}`, await file.read())
  }
}

interface ItemState {
  state: 'ok' | 'missing' | 'size' | 'content'
  logged: boolean
}

async function ingestAcquisition(
  ctx: Ctx,
  vfs: Vfs,
  byPath: Map<string, Vfs['files'][number]>,
  root: { dir: string; text: string; manifest: AcqManifest },
  pack?: { name: string; sha: string; note: { ok: boolean; text: string } | null }
): Promise<void> {
  const m = root.manifest
  const prefix = root.dir ? `${root.dir}/` : ''
  const display = root.dir ? `${vfs.label}/${root.dir}` : vfs.label
  const chain = verifyAcquisitionChain(m.log, m.chain_head, sha)

  // Re-hash every item file that is present. This is the step that makes "sealed" mean something.
  const states = new Map<string, ItemState>()
  const problems: string[] = []
  const known = new Set<string>([`${prefix}manifest.json`])
  const buffers: { path: string; buf: Buffer }[] = []
  for (const item of m.items) {
    const full = `${prefix}${item.path}`
    known.add(full)
    const logged = m.log.some((e) => e.a === 'item' && e.p === itemLogLine(item))
    const file = byPath.get(full)
    if (!file) {
      states.set(item.path, { state: 'missing', logged })
      continue
    }
    const buf = await file.read()
    let state: ItemState['state'] = 'ok'
    if (buf.length !== item.bytes) {
      state = 'size'
      problems.push(`size changed: ${item.path}`)
    } else if (sha(buf) !== item.sha256) {
      state = 'content'
      problems.push(`content changed: ${item.path}`)
    }
    if (!logged) problems.push(`no log entry for: ${item.path}`)
    states.set(item.path, { state, logged })
    if (buf.length <= MAX_TEXT_BYTES) buffers.push({ path: item.path, buf })
  }
  const extras = vfs.files.map((f) => f.path).filter((p) => p.startsWith(prefix) && !known.has(p) && !p.endsWith('manifest.json.tmp'))
  for (const e of extras) problems.push(`not in manifest: ${e.slice(prefix.length)}`)

  const total = m.items.length
  const present = [...states.values()].filter((s) => s.state !== 'missing').length
  const rehashed = [...states.values()].filter((s) => s.state === 'ok').length
  const broken = problems.length > 0 || !chain.ok
  const verified = chain.ok && !broken && present === total && total > 0
  const partial = chain.ok && !broken && present < total

  let verification: Verification
  if (!chain.ok) {
    verification = { state: 'failed', notes: [`The log chain does not verify: ${chain.reason ?? 'altered'}.`, ...problems.slice(0, 6)] }
  } else if (broken) {
    verification = { state: 'failed', notes: ['The log chain verifies, but the files do not match it.', ...problems.slice(0, 8)] }
  } else if (verified) {
    verification = { state: 'verified', notes: [`Log chain of ${chain.entries} entries verifies; ${rehashed} of ${total} files re-hashed and match.`] }
  } else {
    verification = {
      state: 'unchecked',
      notes: [
        `Log chain of ${chain.entries} entries verifies, but ${total - present} of ${total} item files were not provided, so their hashes could not be recomputed.`,
        'Drop the whole acquisition folder (or its .tar.gz pack) to verify it.'
      ]
    }
  }
  if (pack?.note) verification.notes.push(pack.note.text)
  if (pack?.note && !pack.note.ok) verification.state = 'failed'

  const sealedWhole = verification.state === 'verified'
  const factors: EvidenceFactors = {
    sealed: sealedWhole,
    custody: chain.ok && verification.state !== 'failed',
    firsthand: true, // the unit captured it directly off the machine
    timestamped: !!m.created
  }

  const target = [m.target.kind, m.target.address].filter(Boolean).join(' ') || 'unknown target'
  const findings: Finding[] = []
  const facts: EvidenceFacts = {}
  const summary: string[] = [
    `${target}${m.host.hostname ? ` · captured from ${m.host.hostname}` : ''}`,
    `${total} ${total === 1 ? 'item' : 'items'} · ${rehashed} re-hashed here · created ${m.created.slice(0, 19).replace('T', ' ')}Z`
  ]

  if (verification.state === 'failed') {
    findings.push({
      severity: 'critical',
      title: 'The seal is broken',
      detail: verification.notes.slice(0, 5).join(' ')
    })
  } else if (verification.state === 'verified') {
    findings.push({ severity: 'low', title: 'Seal verified here', detail: verification.notes[0] })
  } else {
    findings.push({ severity: 'medium', title: 'Seal not verified', detail: verification.notes.slice(0, 2).join(' ') })
  }

  // Sensor readings and board diagnostics travel with the acquisition; fold what they say into it.
  const identifiers = new Set<string>()
  if (m.host.hostname) identifiers.add(m.host.hostname)
  if (m.examiner) identifiers.add(m.examiner)
  if (m.target.address) identifiers.add(m.target.address.split('@').pop() ?? m.target.address)
  let readingsDone = false
  for (const { path, buf } of buffers) {
    const lower = path.toLowerCase()
    if (!readingsDone && lower.endsWith('.csv') && looksLikeReadings(buf.toString('utf8'))) {
      const r = analyseReadings(buf.toString('utf8'))
      if (r) {
        readingsDone = true
        summary.push(...r.summary.map((l) => `readings: ${l}`))
        findings.push(...r.findings)
        if (r.facts.unmeasured) facts.unmeasured = [...new Set([...(facts.unmeasured ?? []), ...r.facts.unmeasured])]
      }
    } else if (lower.endsWith('metrics.json')) {
      try {
        const metrics = JSON.parse(buf.toString('utf8')) as Record<string, unknown>
        const model = typeof metrics['model'] === 'string' ? metrics['model'].replace(/\0/g, '') : null
        const host = typeof metrics['hostname'] === 'string' ? metrics['hostname'] : null
        if (host) identifiers.add(host)
        if (model) summary.push(`board: ${model}${host ? ` (${host})` : ''}`)
        const throttled = typeof metrics['throttled_raw'] === 'string' ? metrics['throttled_raw'] : null
        if (throttled && !/=0x0$/.test(throttled)) {
          findings.push({ severity: 'high', title: 'The board reported power or thermal flags', detail: `${throttled}: the Pi's own firmware flags under-voltage, throttling or frequency capping.` })
        } else if (throttled) {
          summary.push('board: no under-voltage or throttling flags')
        }
      } catch {
        // metrics that do not parse are simply not summarised
      }
    }
  }
  // Warnings the field unit logged during capture. Unmeasured sensors are the ones that matter most.
  const unmeasured = unmeasuredFromWarnings(m.warnings)
  if (unmeasured.length > 0) {
    facts.unmeasured = [...new Set([...(facts.unmeasured ?? []), ...unmeasured])]
    if (!findings.some((f) => /never measured/.test(f.title))) {
      findings.push({
        severity: 'high',
        title: `${unmeasured.join(', ')} was never measured`,
        detail: m.warnings.filter((w) => /reported no value/.test(w)).slice(0, 2).join(' ')
      })
    }
  }
  const otherWarnings = m.warnings.filter((w) => !/reported no value/.test(w))
  if (otherWarnings.length > 0) {
    findings.push({ severity: 'low', title: `${otherWarnings.length} capture ${otherWarnings.length === 1 ? 'warning' : 'warnings'}`, detail: otherWarnings.slice(0, 4).join(' · ') })
  }
  if (identifiers.size > 0) facts.identifiers = [...identifiers]

  const chainHead = chain.ok ? m.chain_head : null
  const acquisition: AcquisitionSummary = {
    chainHead,
    created: m.created,
    target,
    host: m.host.hostname ?? null,
    examiner: m.examiner ?? null,
    itemCount: total,
    warnings: m.warnings,
    rehashed
  }
  const label = `${display} · ${m.created.slice(11, 19)}`
  const draft: EvidenceDraft = {
    title: `Field-unit acquisition: ${target}${m.created ? ` · ${m.created.slice(0, 16).replace('T', ' ')}` : ''}`,
    type: 'acquisition',
    source: `Janus field unit · ${target}${m.host.hostname ? ` · from ${m.host.hostname}` : ''}`,
    notes: sealedWhole
      ? `Sealed capture, verified here. Chain head ${chainHead?.slice(0, 16)}… · ${total} items.`
      : verification.state === 'failed'
        ? 'Seal broken: files do not match the chain.'
        : 'Seal not verified: item files were not provided.',
    stance: 'neutral',
    strength: 1,
    factors,
    chainHead: chainHead ?? undefined,
    itemCount: total,
    occurredAt: m.created || undefined,
    addedAt: new Date().toISOString(),
    origin: 'fieldunit',
    fileName: pack ? `${pack.name}${root.dir ? `:${root.dir}` : ''}` : display,
    fileSha256: sha(root.text),
    fileBytes: Buffer.byteLength(root.text),
    group: m.chain_head ?? undefined,
    verification,
    findings,
    facts
  }
  const parent = ctx.push({
    key: ctx.key(),
    name: display,
    kind: 'acquisition',
    bytes: Buffer.byteLength(root.text),
    sha256: sha(root.text),
    status: verification.state === 'verified' ? 'ok' : verification.state === 'failed' ? 'error' : 'warn',
    summary,
    findings,
    draft,
    acquisition
  })

  // Pull the analysable files out of the acquisition. Each inherits what the seal proves about *it*:
  // it is sealed only if its own hash matched, and custody only if the chain verifies.
  const analysed: string[] = []
  for (const { path, buf } of buffers) {
    const st = states.get(path)
    if (!st) continue
    const lower = path.toLowerCase()
    if (lower.endsWith('manifest.json') || lower.endsWith('metrics.json') || /pi-stream\.(log|csv)$/.test(lower) || lower.startsWith('pi/logs/')) continue
    const text = decodeText(buf)
    if (text === null) continue
    const recognised = looksLikeJanusLog(text) || looksLikeDiff(text) || (/\.(csv|tsv|json)$/.test(lower) && readLedger(text) !== null)
    if (!recognised) continue
    const itemSealed = chain.ok && st.state === 'ok' && st.logged
    await processLoose(ctx, `${display}/${path}`, buf, {
      factors: { sealed: itemSealed, custody: chain.ok && st.state === 'ok', firsthand: true },
      parent: parent.key,
      group: m.chain_head ?? undefined,
      label,
      verification: itemSealed
        ? { state: 'verified', notes: [`Hash matches the entry logged by the field unit, and the chain of ${chain.entries} entries verifies.`] }
        : { state: 'failed', notes: [`This file does not match what the field unit logged (${st.state}).`] }
    })
    analysed.push(path)
  }
  if (analysed.length > 0) parent.summary.push(`extracted for analysis: ${analysed.map((p) => basename(p)).join(', ')}`)
}

// ---- single files --------------------------------------------------------------------------------

/** Decode as text, or null when the bytes are not text. Handles the UTF-16 BOM Windows tools write. */
export function decodeText(buf: Buffer): string | null {
  if (buf.length === 0) return ''
  if (buf.length > MAX_TEXT_BYTES) return null
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  const head = buf.subarray(0, Math.min(buf.length, 8000))
  if (head.includes(0)) return null
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } catch {
    return null
  }
}

const defaultFactors = (over?: Partial<EvidenceFactors>): EvidenceFactors => ({
  sealed: false,
  custody: false,
  firsthand: false,
  timestamped: false,
  ...over
})

function relabel(item: IntakeItem, inherit: Inherit | undefined, digest: string, name: string): IntakeItem {
  if (inherit?.parent) item.parent = inherit.parent
  if (item.draft) {
    item.draft.fileName = name
    item.draft.fileSha256 = digest
    item.draft.fileBytes = item.bytes
    if (inherit?.group) item.draft.group = inherit.group
    if (inherit?.verification) item.draft.verification = inherit.verification
    item.draft.origin = inherit?.parent ? 'fieldunit' : 'upload'
  }
  return item
}

async function processLoose(ctx: Ctx, name: string, buf: Buffer, inherit?: Inherit): Promise<void> {
  const digest = sha(buf)

  // The same file arriving twice (the same logs.janus in three captures) is one piece of evidence that
  // was reproduced, not three.
  const prior = ctx.byHash.get(digest)
  if (prior) {
    const where = inherit?.label ?? name
    prior.seenIn = [...(prior.seenIn ?? []), where]
    if (prior.draft) {
      prior.draft.facts = { ...(prior.draft.facts ?? {}), reproducedIn: 1 + prior.seenIn.length }
      // If this copy came out of a verified acquisition and the first did not, the better provenance wins.
      if (inherit?.factors?.sealed && !prior.draft.factors.sealed) {
        prior.draft.factors = { ...prior.draft.factors, ...inherit.factors }
        prior.draft.verification = inherit.verification
        prior.draft.group = inherit.group
        prior.parent = inherit.parent
      }
    }
    prior.summary = prior.summary.filter((l) => !l.startsWith('identical copy in'))
    prior.summary.push(`identical copy in ${prior.seenIn.length} other ${prior.seenIn.length === 1 ? 'capture' : 'captures'} (same SHA-256)`)
    return
  }

  const base = {
    name,
    bytes: buf.length,
    sha256: digest
  }
  const text = decodeText(buf)
  const factors = (over?: Partial<EvidenceFactors>): EvidenceFactors => defaultFactors({ ...over, ...inherit?.factors })

  // ---- not text -------------------------------------------------------------------------------
  if (text === null) {
    const item: IntakeItem = {
      ...base,
      key: ctx.key(),
      kind: 'file',
      status: 'warn',
      summary: [`Binary or unreadable file, ${buf.length.toLocaleString('en-US')} bytes. Hashed and filed, but its content was not read.`],
      findings: [],
      draft: {
        title: basename(name),
        type: 'other',
        source: name,
        notes: '',
        stance: 'neutral',
        strength: 1,
        factors: factors(),
        addedAt: new Date().toISOString()
      }
    }
    ctx.byHash.set(digest, ctx.push(relabel(item, inherit, digest, name)))
    return
  }

  // ---- a cabinet record (logs.janus) -----------------------------------------------------------
  if (looksLikeJanusLog(text)) {
    const parsed = parseJanusLog(text)
    if (parsed) {
      const a = analyseJanusLog(parsed)
      const where = a.facts.coverage ? `${a.facts.coverage.from.slice(0, 10)} → ${a.facts.coverage.to.slice(0, 10)}` : ''
      const item: IntakeItem = {
        ...base,
        key: ctx.key(),
        kind: 'telemetry',
        status: a.findings.some((f) => f.severity === 'high' || f.severity === 'critical') ? 'warn' : 'ok',
        summary: a.summary,
        findings: a.findings,
        profile: a.profile ?? undefined,
        draft: {
          title: `Cabinet record: ${(a.facts.machine ?? basename(name)).split(' · ').pop()}${where ? ` (${where})` : ''}`,
          type: 'system_log',
          source: inherit?.label ? `${basename(name)} · from ${inherit.label}` : name,
          notes: '',
          stance: 'neutral',
          strength: 1,
          factors: factors({ timestamped: true }),
          occurredAt: undefined,
          addedAt: new Date().toISOString(),
          findings: a.findings,
          facts: { ...a.facts, baseName: basename(name), reproducedIn: 1 }
        }
      }
      ctx.byHash.set(digest, ctx.push(relabel(item, inherit, digest, name)))
      return
    }
  }

  // ---- a bare manifest.json: a claim without its files ----------------------------------------
  const manifest = parseManifest(text)
  if (manifest) {
    await ingestManifestOnly(ctx, name, text, manifest)
    return
  }

  // ---- another agent's case file ----------------------------------------------------------------
  if (text.trimStart().startsWith('{') && text.includes(CASE_FILE_SCHEMA)) {
    try {
      const file = JSON.parse(text) as Partial<CaseFile>
      if (file.schema === CASE_FILE_SCHEMA && file.investigation && Array.isArray(file.evidence)) {
        const log = Array.isArray(file.log) ? file.log : []
        const chain = log.length > 0 ? verifyChain(log) : { ok: true as const }
        const agents = [...new Set(file.evidence.map((e) => e.agentId))]
        const findings: Finding[] = []
        const summary = [
          `Case “${file.investigation.title}”`,
          `${file.evidence.length} evidence ${file.evidence.length === 1 ? 'item' : 'items'}${agents.length ? ` from ${agents.join(', ')}` : ''}`,
          file.redaction ? 'a redacted copy: identifying details were removed before it was shared' : log.length ? `case log of ${log.length} entries ${chain.ok ? 'verifies' : 'does NOT verify'}` : 'no case log'
        ]
        if (!chain.ok) findings.push({ severity: 'critical', title: 'The case log does not verify', detail: 'This case file’s log was altered after it was written.' })
        const signature = verifyCaseFile(file as CaseFile)
        if (signature.state === 'invalid') findings.push({ severity: 'critical', title: 'The signature does not match', detail: 'This case file was changed after it was signed, or the signature is not genuine.' })
        ctx.push({ ...base, key: ctx.key(), kind: 'case-file', status: chain.ok && signature.state !== 'invalid' ? 'ok' : 'error', summary, findings, caseFile: file as CaseFile, signature })
        return
      }
    } catch {
      // not a case file after all
    }
  }

  const pii = scanForIdentifiers(text)
  const piiLine = describeCounts(pii)

  // ---- a code diff ---------------------------------------------------------------------------------
  if (looksLikeDiff(text)) {
    const d = analyseDiff(text)
    const item: IntakeItem = {
      ...base,
      key: ctx.key(),
      kind: 'diff',
      status: d.findings.some((f) => f.severity === 'high') ? 'warn' : 'ok',
      summary: [...d.summary, ...(piiLine ? [`contains ${piiLine}`] : [])],
      findings: d.findings,
      draft: {
        title: `Game-code diff: ${basename(name)}`,
        type: 'code_diff',
        source: inherit?.label ? `${basename(name)} · from ${inherit.label}` : name,
        notes: '',
        stance: 'neutral',
        strength: 2,
        factors: factors({ timestamped: d.dated !== null }),
        occurredAt: d.dated ?? undefined,
        addedAt: new Date().toISOString(),
        findings: d.findings,
        facts: { baseName: basename(name) }
      }
    }
    ctx.byHash.set(digest, ctx.push(relabel(item, inherit, digest, name)))
    return
  }

  // ---- live sensor readings -----------------------------------------------------------------------
  if (looksLikeReadings(text)) {
    const r = analyseReadings(text)
    if (r) {
      const item: IntakeItem = {
        ...base,
        key: ctx.key(),
        kind: 'readings',
        status: r.findings.some((f) => f.severity === 'high') ? 'warn' : 'ok',
        summary: r.summary,
        findings: r.findings,
        draft: {
          title: `Sensor readings: ${basename(name)}`,
          type: 'system_log',
          source: name,
          notes: '',
          stance: 'neutral',
          strength: 1,
          factors: factors({ timestamped: true }),
          addedAt: new Date().toISOString(),
          findings: r.findings,
          facts: { ...r.facts, baseName: basename(name) }
        }
      }
      ctx.byHash.set(digest, ctx.push(relabel(item, inherit, digest, name)))
      return
    }
  }

  // ---- field-unit output pasted into a file (--ndjson run, a printed chain head) ----------------
  if (/"event"\s*:\s*"(acquisition|done)"/.test(text) || (/^[0-9a-f]{64}\s*$/im.test(text) && text.length < 400)) {
    const parsed = parseFieldUnitAcquisition(text)
    if (parsed.ok && parsed.draft) {
      const item: IntakeItem = {
        ...base,
        key: ctx.key(),
        kind: 'acquisition',
        status: 'warn',
        summary: [parsed.note],
        findings: parsed.draft.findings ?? [],
        draft: { ...parsed.draft, fileName: name, fileSha256: digest, fileBytes: buf.length, origin: 'fieldunit' }
      }
      ctx.byHash.set(digest, ctx.push(item))
      return
    }
  }

  // ---- a meter ledger -----------------------------------------------------------------------------
  if (/\.(csv|tsv|json|txt)$/i.test(name)) {
    const read = readLedger(text)
    if (read) {
      const a = analyseLedger(read, ctx.today)
      const item: IntakeItem = {
        ...base,
        key: ctx.key(),
        kind: 'ledger',
        status: a.findings.some((f) => f.severity === 'high') ? 'warn' : 'ok',
        summary: a.summary,
        findings: a.findings,
        profile: a.profile,
        draft: {
          title: `Meter ledger: ${basename(name)}`,
          type: 'meter_log',
          source: inherit?.label ? `${basename(name)} · from ${inherit.label}` : name,
          notes: '',
          stance: 'neutral',
          strength: 2,
          factors: factors({ timestamped: true }),
          addedAt: new Date().toISOString(),
          findings: a.findings,
          facts: { ...a.facts, baseName: basename(name) }
        }
      }
      ctx.byHash.set(digest, ctx.push(relabel(item, inherit, digest, name)))
      return
    }
  }

  // ---- text that is not an account: source code, configuration, markup -------------------------
  // A snapshot of code cannot show what changed, so it is filed (hashed, not interpreted) rather than
  // mistaken for a witness statement. A diff against a known-good baseline is the evidence that matters.
  const ext = extname(name).toLowerCase()
  if ((ext !== '' && !DOC_EXTENSIONS.has(ext)) || basename(name).startsWith('.')) {
    const lines = text.split('\n').length
    const item: IntakeItem = {
      ...base,
      key: ctx.key(),
      kind: 'file',
      status: 'ok',
      summary: [
        `${lines.toLocaleString('en-US')} lines of ${ext.slice(1) || 'text'}. Filed and hashed, not interpreted.`,
        ...(CODE_EXTENSIONS.has(ext) ? ['A snapshot of code cannot show what changed. Add a diff against a known-good baseline instead.'] : []),
        ...(piiLine ? [`contains ${piiLine}`] : [])
      ],
      findings: [],
      draft: {
        title: basename(name),
        type: 'other',
        source: name,
        notes: '',
        stance: 'neutral',
        strength: 1,
        factors: factors(),
        addedAt: new Date().toISOString()
      }
    }
    ctx.byHash.set(digest, ctx.push(relabel(item, inherit, digest, name)))
    return
  }

  // ---- anything else that is text: an account, a note, a statement -----------------------------
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const dateMatch = /\b(20\d{2}-\d{2}-\d{2})(?:(?:[T ]|\s+at\s+)(\d{2}:\d{2}))?/.exec(text)
  const looksLikeReport = /report|memo|analysis|summary|findings/i.test(basename(name))
  const excerpt = text.trim().replace(/\s+/g, ' ').slice(0, 160)
  const item: IntakeItem = {
    ...base,
    key: ctx.key(),
    kind: 'narrative',
    status: 'ok',
    summary: [
      `${words.toLocaleString('en-US')} words${dateMatch ? ` · first dated ${dateMatch[1]}` : ''}`,
      `“${excerpt}${text.trim().length > 160 ? '…' : ''}”`,
      ...(piiLine ? [`contains ${piiLine}`] : [])
    ],
    findings: [],
    draft: {
      title: basename(name).replace(extname(name), ''),
      type: looksLikeReport ? 'report' : /\.log$|journal|syslog|dmesg/i.test(name) ? 'system_log' : 'witness',
      source: name,
      notes: '',
      stance: 'neutral',
      strength: 2,
      factors: factors({ firsthand: true, timestamped: !!dateMatch }),
      occurredAt: dateMatch ? `${dateMatch[1]}${dateMatch[2] ? `T${dateMatch[2]}:00` : ''}` : undefined,
      addedAt: new Date().toISOString()
    }
  }
  ctx.byHash.set(digest, ctx.push(relabel(item, inherit, digest, name)))
}

/** A manifest dropped on its own: the field unit's account of a capture, without the capture. */
async function ingestManifestOnly(ctx: Ctx, name: string, text: string, m: AcqManifest): Promise<void> {
  const chain = verifyAcquisitionChain(m.log, m.chain_head, sha)
  const target = [m.target.kind, m.target.address].filter(Boolean).join(' ') || 'unknown target'
  const verification: Verification = chain.ok
    ? {
        state: 'unchecked',
        notes: [
          `The manifest's own log chain of ${chain.entries} entries verifies, but no item files came with it, so nothing was re-hashed.`,
          'A manifest alone shows the record is self-consistent, not that the files are unaltered. Drop the acquisition folder to verify it.'
        ]
      }
    : { state: 'failed', notes: [`The manifest's log chain does not verify: ${chain.reason ?? 'altered'}.`] }
  const findings: Finding[] = [
    chain.ok
      ? { severity: 'medium', title: 'Seal not verified', detail: verification.notes.join(' ') }
      : { severity: 'critical', title: 'The seal is broken', detail: verification.notes[0] }
  ]
  const unmeasured = unmeasuredFromWarnings(m.warnings)
  const facts: EvidenceFacts = {}
  if (unmeasured.length > 0) {
    facts.unmeasured = unmeasured
    findings.push({ severity: 'high', title: `${unmeasured.join(', ')} was never measured`, detail: m.warnings.filter((w) => /reported no value/.test(w)).slice(0, 2).join(' ') })
  }
  const identifiers = [m.host.hostname, m.examiner, m.target.address].filter((x): x is string => !!x)
  if (identifiers.length) facts.identifiers = identifiers
  const acquisition: AcquisitionSummary = {
    chainHead: chain.ok ? m.chain_head : null,
    created: m.created,
    target,
    host: m.host.hostname ?? null,
    examiner: m.examiner ?? null,
    itemCount: m.items.length,
    warnings: m.warnings,
    rehashed: 0
  }
  ctx.push({
    key: ctx.key(),
    name,
    kind: 'acquisition',
    bytes: Buffer.byteLength(text),
    sha256: sha(text),
    status: chain.ok ? 'warn' : 'error',
    summary: [`${target} · manifest only (${m.items.length} items listed, none provided)`],
    findings,
    acquisition,
    draft: {
      title: `Field-unit acquisition (manifest only): ${target}`,
      type: 'acquisition',
      source: `Janus field unit · ${target}`,
      notes: `Manifest only. Chain head ${m.chain_head?.slice(0, 16) ?? '?'}… Item files were not provided.`,
      stance: 'neutral',
      strength: 1,
      factors: { sealed: false, custody: chain.ok, firsthand: true, timestamped: !!m.created },
      chainHead: chain.ok ? (m.chain_head ?? undefined) : undefined,
      itemCount: m.items.length,
      occurredAt: m.created || undefined,
      addedAt: new Date().toISOString(),
      origin: 'fieldunit',
      fileName: name,
      fileSha256: sha(text),
      fileBytes: Buffer.byteLength(text),
      group: m.chain_head ?? undefined,
      verification,
      findings,
      facts
    }
  })
}

export { ACQUISITION_SCHEMA }
