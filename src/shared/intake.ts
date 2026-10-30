// What the intake step hands the interface: every dropped file, read, hashed, identified and analysed,
// and ready to be reviewed before it becomes evidence. The raw bytes stay in the main process; only
// this summary crosses to the renderer.

import type { Evidence, Finding } from './evidence'
import type { CaseFile } from './investigation'

/** What checking a case file's signature found. */
export interface SignatureCheck {
  state: 'unsigned' | 'valid' | 'invalid'
  fingerprint?: string
  signer?: string
  signedAt?: string
}
import type { LedgerProfile } from './ledger'
import type { TelemetryProfile } from './januslog'

export type IntakeKind =
  | 'acquisition' // a field-unit capture (folder, pack or manifest)
  | 'telemetry' // a JANUS-LOG/1 cabinet record (logs.janus)
  | 'ledger' // an electricity meter ledger
  | 'diff' // a game-code diff
  | 'readings' // a live sensor readings file
  | 'narrative' // a witness account, notes, a statement
  | 'case-file' // another agent's .janus-case
  | 'encrypted' // a sealed file waiting for its passphrase
  | 'file' // anything else: hashed and filed, not read

export type EvidenceDraft = Omit<Evidence, 'id' | 'investigationId' | 'agentId'>

export type IntakeProfile = TelemetryProfile | LedgerProfile

export interface AcquisitionSummary {
  chainHead: string | null
  created: string
  target: string
  host: string | null
  examiner: string | null
  itemCount: number
  warnings: string[]
  /** How many item files were present and re-hashed here, out of how many the manifest lists. */
  rehashed: number
}

export interface IntakeItem {
  /** Unique within the batch. */
  key: string
  /** Path as the agent dropped it, for display. */
  name: string
  kind: IntakeKind
  bytes: number
  /** SHA-256 of the file as Janus read it. */
  sha256: string
  status: 'ok' | 'warn' | 'error' | 'locked'
  /** Plain-language lines about what was found. */
  summary: string[]
  findings: Finding[]
  /** Ready to become evidence once the agent confirms stance and factors. */
  draft?: EvidenceDraft
  /** What a stance suggestion needs, so it can follow the incident window. */
  profile?: IntakeProfile
  acquisition?: AcquisitionSummary
  /** Acquisition this item was extracted from. */
  parent?: string
  /** Other acquisitions that contained this exact file. */
  seenIn?: string[]
  caseFile?: CaseFile
  /** For a case file: whether it is signed, and whether the signature holds. */
  signature?: SignatureCheck
  /** For a sealed file: the path to retry with a passphrase. */
  lockedPath?: string
  error?: string
}

export interface IntakeBatch {
  items: IntakeItem[]
  skipped: { name: string; reason: string }[]
}

export const EMPTY_BATCH: IntakeBatch = { items: [], skipped: [] }
