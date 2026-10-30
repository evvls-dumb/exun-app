import type { Evidence } from './evidence'
import type { CaseLogEntry } from './casechain'
import type { Hypothesis } from './evidence'
import type { IncidentWindow } from './januslog'
import type { RedactKind } from './redact'

export interface Investigation {
  id: string
  title: string
  hypothesis: string
  lead: string
  createdAt: string
  /** The competing explanations this case weighs (ACH). Defaults are used when absent. */
  hypotheses?: Hypothesis[]
  /** When the incident is believed to have happened. Records that stop short of it are flagged, and
   *  records that cover it are weighed for or against the hypothesis. */
  incident?: IncidentWindow
  /** Free-form kind of incident (arcade escape, power anomaly, …). Lets one platform hold many. */
  tag?: string
  /** The last time analysis was run, and a digest of what it was run on. */
  analysis?: AnalysisStamp
  /** Every agent who has contributed to the case, so the report can name them. */
  agents?: string[]
}

export interface AnalysisStamp {
  at: string
  by: string
  /** Digest of the evidence and incident window the analysis ran on. A different digest later means the
   *  case has changed since. */
  digest: string
}

export interface Report {
  body: string
  recipients: string[]
}

export type AiCaseAccess = 'off' | 'redacted' | 'full'

export interface PrivacySettings {
  /** Whether the AI agent (a third-party model) may read case data at all. Off by default. */
  aiCaseAccess: AiCaseAccess
  /** Minutes of inactivity before a sealed vault locks itself. 0 = never. */
  autoLockMinutes: number
  /** Strip identifying details from the copy of a case or report that is shared. */
  redactOnShare: boolean
  redactKinds: Record<Exclude<RedactKind, 'listed'>, boolean>
}

export interface PlatformSettings {
  /** The callsign this agent signs evidence, log entries and exports with. */
  agent: string
  privacy: PrivacySettings
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  agent: 'agent',
  privacy: {
    aiCaseAccess: 'off',
    autoLockMinutes: 15,
    redactOnShare: true,
    redactKinds: { email: true, ip: true, mac: true, path: true, secret: true, phone: true }
  }
}

export interface ActionItem {
  id: string
  text: string
  status: 'open' | 'doing' | 'done'
  owner?: string
  /** ISO date */
  due?: string
  /** recommended: taken from the analysis's next steps. manual: written by an agent. */
  source: 'recommended' | 'manual'
  createdAt: string
  doneAt?: string
}

export interface InvestigationStore {
  investigations: Investigation[]
  evidence: Evidence[]
  reports: Record<string, Report>
  logs: Record<string, CaseLogEntry[]>
  settings: PlatformSettings
  /** Tracked work per investigation. */
  actions: Record<string, ActionItem[]>
  /** Signers met so far, by fingerprint. */
  signers: Record<string, SignerRecord>
}

/** A signature over a case file, made with the exporting agent's identity key. */
export interface CaseSignature {
  alg: 'ed25519'
  /** SPKI DER, base64. */
  publicKey: string
  /** Shown to people so they can compare it with the sender by another route. Recomputed from publicKey on checking. */
  fingerprint: string
  signature: string
  signedAt: string
  signer: string
}

/** Someone whose signed files this agent has met. */
export interface SignerRecord {
  agent: string
  firstSeen: string
  /** The person confirmed the fingerprint with the sender outside Janus. */
  trusted: boolean
}

export const CASE_FILE_SCHEMA = 'janus.case/1'

/** One investigation packaged for handoff to another agent: the case, its evidence and its report. */
export interface CaseFile {
  schema: typeof CASE_FILE_SCHEMA
  exportedAt: string
  exportedBy?: string
  investigation: Investigation
  evidence: Evidence[]
  report: Report | null
  log: CaseLogEntry[]
  /** Present when the exporter signed the file. Covers everything else in it. */
  signature?: CaseSignature
  /** Present when the copy was redacted. A redacted copy cannot carry its case log (the hashes would no
   *  longer match), so it carries the original head and length instead. */
  redaction?: {
    counts: Partial<Record<RedactKind, number>>
    originalLogHead: string | null
    originalLogEntries: number
  }
}

export function emptyStore(): InvestigationStore {
  return {
    investigations: [],
    evidence: [],
    reports: {},
    logs: {},
    settings: structuredCloneSettings(DEFAULT_SETTINGS),
    actions: {},
    signers: {}
  }
}

export function structuredCloneSettings(s: PlatformSettings): PlatformSettings {
  return { agent: s.agent, privacy: { ...s.privacy, redactKinds: { ...s.privacy.redactKinds } } }
}

/** Fill any settings an older store file lacks, so new options get safe defaults. */
export function normaliseSettings(raw: unknown): PlatformSettings {
  const base = structuredCloneSettings(DEFAULT_SETTINGS)
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Partial<PlatformSettings>
  if (typeof r.agent === 'string' && r.agent.trim()) base.agent = r.agent.trim().slice(0, 40)
  const p = (r.privacy ?? {}) as Partial<PrivacySettings>
  if (p.aiCaseAccess === 'off' || p.aiCaseAccess === 'redacted' || p.aiCaseAccess === 'full') base.privacy.aiCaseAccess = p.aiCaseAccess
  if (typeof p.autoLockMinutes === 'number' && p.autoLockMinutes >= 0 && p.autoLockMinutes <= 1440) base.privacy.autoLockMinutes = Math.round(p.autoLockMinutes)
  if (typeof p.redactOnShare === 'boolean') base.privacy.redactOnShare = p.redactOnShare
  if (p.redactKinds && typeof p.redactKinds === 'object') {
    for (const k of Object.keys(base.privacy.redactKinds) as (keyof PrivacySettings['redactKinds'])[]) {
      const v = (p.redactKinds as Record<string, unknown>)[k]
      if (typeof v === 'boolean') base.privacy.redactKinds[k] = v
    }
  }
  return base
}

// ---- merging what another agent sends back --------------------------------------------------------

export interface MergeResult {
  added: Evidence[]
  duplicates: number
  agents: string[]
}

function sameEvidence(a: Evidence, b: Evidence): boolean {
  if (a.id === b.id) return true
  // The same file, filed by the same agent under the same title, is the same evidence even when the
  // two copies were given different ids on different machines.
  return !!a.fileSha256 && a.fileSha256 === b.fileSha256 && a.agentId === b.agentId && a.title === b.title
}

/** Combine another agent's evidence into a case without losing or duplicating anything. */
export function mergeContribution(existing: readonly Evidence[], incoming: readonly Evidence[], investigationId: string): MergeResult {
  const added: Evidence[] = []
  let duplicates = 0
  for (const item of incoming) {
    if (existing.some((e) => sameEvidence(e, item)) || added.some((e) => sameEvidence(e, item))) {
      duplicates++
      continue
    }
    added.push({ ...item, investigationId, origin: 'merge' })
  }
  const agents = [...new Set(added.map((e) => e.agentId))]
  return { added, duplicates, agents }
}
