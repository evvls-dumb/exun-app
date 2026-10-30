// Making a copy of a case that is safe to hand to someone else, or to a third-party model.
//
// A redacted copy replaces identifying details (addresses, user folders, keys, listed names) with stable
// pseudonyms, field by field. It never touches ids, hashes, chain heads or versions: those are integrity
// anchors the recipient needs. Because redaction changes the text that the case log was hashed over, a
// redacted case file cannot carry its log; it records the original head and length instead, so the
// original can still be matched to it by anyone who holds the unredacted case.

import { Redactor, type RedactKind, type RedactOptions } from './redact'
import { CASE_FILE_SCHEMA, type CaseFile, type Investigation, type PrivacySettings } from './investigation'
import type { Evidence } from './evidence'
import type { CaseLogEntry } from './casechain'
import { chainHead } from './casechain'

/** Keys whose values are identifiers or integrity anchors, never personal data. */
const KEEP_KEYS = new Set([
  'id', 'investigationId', 'chainHead', 'fileSha256', 'group', 'hash', 'prev', 'sha256', 'schema',
  'addedAt', 'occurredAt', 'createdAt', 'exportedAt', 'at', 'digest', 'type', 'stance', 'grade', 'severity',
  'state', 'origin', 'from', 'to', 'date'
])

export function redactValue<T>(value: T, redactor: Redactor, key = ''): T {
  if (typeof value === 'string') {
    if (KEEP_KEYS.has(key)) return value
    return redactor.apply(value) as unknown as T
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, redactor, key)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, redactor, k)
    return out as T
  }
  return value
}

export function redactOptionsFrom(privacy: PrivacySettings, listed: readonly string[]): RedactOptions {
  const k = privacy.redactKinds
  return { email: k.email, ip: k.ip, mac: k.mac, path: k.path, secret: k.secret, phone: k.phone, listed: [...listed] }
}

/** Names of the people and machines in a case: the examiner, hosts, agents. These are redacted by name
 *  wherever else they appear in free text. */
export function namesIn(evidence: readonly Evidence[], investigation: Investigation, agent: string): string[] {
  const out = new Set<string>([agent, investigation.lead, ...(investigation.agents ?? [])])
  for (const e of evidence) {
    out.add(e.agentId)
    if (e.facts?.machine) out.add(e.facts.machine)
  }
  return [...out].map((s) => s?.trim()).filter((s): s is string => !!s && s.length >= 3 && s !== 'agent' && s !== 'you')
}

export interface ShareCopy {
  file: CaseFile
  counts: Partial<Record<RedactKind, number>>
}

export function redactCaseFile(file: CaseFile, options: RedactOptions): ShareCopy {
  const r = new Redactor(options)
  const out: CaseFile = {
    ...file,
    investigation: redactValue(file.investigation, r),
    evidence: redactValue(file.evidence, r),
    report: file.report ? redactValue(file.report, r) : null,
    log: [] as CaseLogEntry[],
    redaction: {
      counts: r.counts,
      originalLogHead: chainHead(file.log),
      originalLogEntries: file.log.length
    }
  }
  // Counts are read after all fields have been processed.
  out.redaction = { ...out.redaction!, counts: { ...r.counts } }
  return { file: out, counts: { ...r.counts } }
}

/** What the AI agent is allowed to see of a case, under the analyst's setting. */
export function evidenceForAi(
  evidence: readonly Evidence[],
  investigation: Investigation,
  privacy: PrivacySettings,
  agent: string
): { evidence: Evidence[]; investigation: Investigation; redacted: boolean } {
  if (privacy.aiCaseAccess !== 'redacted') return { evidence: [...evidence], investigation, redacted: false }
  const r = new Redactor(redactOptionsFrom({ ...privacy, redactKinds: privacy.redactKinds }, namesIn(evidence, investigation, agent)))
  return { evidence: redactValue([...evidence], r), investigation: redactValue(investigation, r), redacted: true }
}

export { CASE_FILE_SCHEMA }
