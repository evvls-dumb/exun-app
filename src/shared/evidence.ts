// The investigation layer: heterogeneous evidence, graded for reliability, weighed into a verdict.
//
// The meter log (see meter.ts) is one kind of evidence. An investigation gathers many, sealed
// field-unit acquisitions, game-code diffs, system logs, witness accounts, agents' own reports, from
// more than one agent, and this module turns that pile into something an investigator can act on:
// a reliability grade (A–F) per item, the discrepancies between them, a weighted probability for the
// case hypothesis with a confidence band, and the next steps to take when it is not yet conclusive.
//
// Everything here is pure and deterministic: the same evidence always grades and assesses the same way,
// so a verdict can be re-derived and defended. No Electron, no React, no clock, callers pass the time.

import { sha256 } from './sha256'

export type EvidenceType =
  | 'acquisition' // a sealed capture from the field unit (hash-chained)
  | 'code_diff' // what changed in the machine's game code between two captures
  | 'meter_log' // the electricity ledger this app already analyses
  | 'system_log' // a Pi/arcade system log, journal, dmesg
  | 'witness' // an agent's or bystander's account
  | 'report' // an analysis or report written by an agent
  | 'other'

export type Stance = 'supports' | 'refutes' | 'neutral'
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Verdict = 'inconclusive' | 'leaning' | 'supported' | 'refuted'
export type Confidence = 'Low' | 'Moderate' | 'High'

/** The four things that make a piece of evidence trustworthy. An agent sets these when they submit it;
 *  a sealed field-unit import sets all four automatically (see fieldunit.ts). */
export interface EvidenceFactors {
  sealed: boolean // tamper-evident: hash-verified / signed, so it can be shown unaltered
  custody: boolean // a recorded chain of custody from source to here
  firsthand: boolean // collected directly, not relayed or hearsay
  timestamped: boolean // carries a reliable time, not just a claim
}

export interface Evidence {
  id: string
  investigationId: string
  title: string
  type: EvidenceType
  source: string // device, host, file or person it came from
  agentId: string // who submitted it
  notes: string
  stance: Stance // does it support or refute the investigation's hypothesis
  strength: 1 | 2 | 3 // how strongly it bears on the hypothesis, if true
  factors: EvidenceFactors
  chainHead?: string // 64-hex seal from a field-unit acquisition, when sealed
  itemCount?: number // files/items in an imported acquisition
  occurredAt?: string // when the event it records happened (ISO), if known
  addedAt: string // when it was submitted (ISO)
  /** ACH: how this evidence sits with each hypothesis, by hypothesis id. Optional. */
  consistency?: Record<string, AchRating>

  // ---- Provenance and analysis, filled in when evidence arrives as a file ----
  origin?: 'manual' | 'upload' | 'fieldunit' | 'merge'
  fileName?: string // the file it was read from, relative to what the agent dropped
  fileSha256?: string // SHA-256 of that file as it was when Janus ingested it
  fileBytes?: number
  /** Chain head of the acquisition this item was extracted from, so siblings stay together. */
  group?: string
  /** What checking the seal found: the field unit's hash chain and per-file hashes, recomputed here. */
  verification?: Verification
  /** What the analyzer for this kind of file found in it, in plain terms. */
  findings?: Finding[]
  /** Structured facts other evidence can be checked against (time span, draw, declared origin…). */
  facts?: EvidenceFacts
}

export interface Verification {
  state: 'verified' | 'failed' | 'unchecked'
  notes: string[]
}

/** One thing an analyzer noticed. Findings describe the file; they do not decide the case. */
export interface Finding {
  severity: Severity
  title: string
  detail: string
}

export interface EvidenceFacts {
  /** The span of time the evidence actually covers. */
  coverage?: { from: string; to: string }
  /** What the record says about its own origin (e.g. "synthetic_scenario_data"). */
  declaredOrigin?: string
  /** The machine it describes. */
  machine?: string
  /** Electrical energy the cabinet's own telemetry accounts for, per day. */
  cabinetKwhPerDay?: number
  /** A spike found in a meter ledger. */
  spike?: { date: string; kwh: number; baselineKwh: number }
  /** Quantities the source reports it never measured. These are not zero. */
  unmeasured?: string[]
  /** Quantities presented as readings that the source says are estimated or modeled. */
  modeled?: string[]
  /** Base name of the file, used to spot two different versions of "the same" log. */
  baseName?: string
  /** Number of independent captures in which this exact file (same SHA-256) was seen. */
  reproducedIn?: number
  /** Hostnames, examiner names and addresses found in the source, so redaction knows what to look for. */
  identifiers?: string[]
}

/** One line of the reliability score, so a grade can be defended instead of trusted. */
export interface GradeFactor {
  label: string
  points: number
  on: boolean
}

export interface GradedEvidence extends Evidence {
  score: number // 0–100 reliability
  grade: Grade
  corroborated: boolean // an independent agent filed evidence of the same stance
  breakdown: GradeFactor[] // what the score is made of
}

export interface Discrepancy {
  severity: Severity
  title: string
  detail: string
  evidenceIds: string[]
  /** The concrete step that would resolve it. Feeds the case's recommended next steps. */
  action?: string
}

/** What the platform knows about the case beyond its evidence. */
export interface AssessContext {
  /** When the incident is believed to have happened, as ISO dates (whole days) or date-times. */
  incident?: { from: string; to: string } | null
}

export interface Assessment {
  graded: GradedEvidence[]
  discrepancies: Discrepancy[]
  /** Probability the hypothesis holds, 0–1, from the balance of graded support vs refutation.
   *  null when no evidence takes a side yet. */
  probability: number | null
  /** The probability pulled toward even odds in proportion to how little the evidence can bear: what to
   *  show a person. One weak item on one side is a raw 100%, but it is not a 100% case. */
  estimate: number | null
  confidence: number // 0–1, how much weight to put on that probability
  confidenceLabel: Confidence
  verdict: Verdict
  nextSteps: string[]
  supportWeight: number
  refuteWeight: number
}

// Reliability is additive and transparent: each factor is worth a fixed number of points, and
// independent corroboration adds the rest. The weights sum to 100.
export const FACTOR_WEIGHTS: Readonly<Record<keyof EvidenceFactors, number>> = {
  sealed: 30,
  custody: 20,
  firsthand: 20,
  timestamped: 15
}
export const CORROBORATION_WEIGHT = 15

const GRADE_CUTOFFS: readonly [number, Grade][] = [
  [88, 'A'],
  [74, 'B'],
  [58, 'C'],
  [42, 'D'],
  [26, 'E'],
  [0, 'F']
]

/** Digital evidence can be silently altered, so for these types "sealed" is the difference between
 *  proof and a claim. Witness and report evidence is judged on the other factors. */
const DIGITAL_TYPES: ReadonlySet<EvidenceType> = new Set<EvidenceType>([
  'acquisition',
  'code_diff',
  'meter_log',
  'system_log'
])

const WEAK_GRADES: ReadonlySet<Grade> = new Set<Grade>(['D', 'E', 'F'])
const RELIABLE_GRADES: ReadonlySet<Grade> = new Set<Grade>(['A', 'B', 'C'])

export function gradeForScore(score: number): Grade {
  return (GRADE_CUTOFFS.find(([cutoff]) => score >= cutoff) ?? [0, 'F'])[1]
}

function round(value: number, places = 0): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function isCorroborated(item: Evidence, all: readonly Evidence[]): boolean {
  if (item.stance === 'neutral') return false
  return all.some(
    (other) =>
      other.id !== item.id && other.stance === item.stance && other.agentId !== item.agentId
  )
}

/** Grade one piece of evidence in the context of the whole set (corroboration needs the others). */
export function gradeEvidence(item: Evidence, all: readonly Evidence[]): GradedEvidence {
  let score = 0
  for (const key of Object.keys(FACTOR_WEIGHTS) as (keyof EvidenceFactors)[]) {
    if (item.factors[key]) score += FACTOR_WEIGHTS[key]
  }
  const corroborated = isCorroborated(item, all)
  if (corroborated) score += CORROBORATION_WEIGHT
  score = Math.min(100, score)
  const breakdown: GradeFactor[] = [
    { label: 'Sealed / hash-verified', points: FACTOR_WEIGHTS.sealed, on: item.factors.sealed },
    { label: 'Chain of custody', points: FACTOR_WEIGHTS.custody, on: item.factors.custody },
    { label: 'Firsthand', points: FACTOR_WEIGHTS.firsthand, on: item.factors.firsthand },
    { label: 'Timestamped', points: FACTOR_WEIGHTS.timestamped, on: item.factors.timestamped },
    { label: 'Independently corroborated', points: CORROBORATION_WEIGHT, on: corroborated }
  ]
  return { ...item, score, grade: gradeForScore(score), corroborated, breakdown }
}

export function gradeAll(evidence: readonly Evidence[]): GradedEvidence[] {
  return evidence.map((item) => gradeEvidence(item, evidence))
}

function weightOf(item: GradedEvidence): number {
  return (item.score / 100) * item.strength
}

/** Everything inconsistent or weak about the evidence set, most severe first. These are what the
 *  app surfaces so an agent can see why a case is or is not yet conclusive. */
export function findDiscrepancies(graded: readonly GradedEvidence[], today?: string, context: AssessContext = {}): Discrepancy[] {
  const found: Discrepancy[] = []

  for (const item of graded) {
    if (DIGITAL_TYPES.has(item.type) && !item.factors.sealed) {
      found.push({
        severity: 'high',
        title: 'Digital evidence is not sealed',
        detail: `${item.title} is ${label(item.type)} but carries no hash seal, so it cannot be shown unaltered since collection.`,
        evidenceIds: [item.id]
      })
    }
  }

  for (const item of graded) {
    if (WEAK_GRADES.has(item.grade)) {
      found.push({
        severity: 'medium',
        title: 'Low-reliability evidence',
        detail: `${item.title} grades ${item.grade}. Treat its claim with caution until it is corroborated or re-collected.`,
        evidenceIds: [item.id]
      })
    }
  }

  const firsthandAgents = new Set(
    graded.filter((item) => item.factors.firsthand).map((item) => item.agentId)
  )
  if (graded.length > 0 && firsthandAgents.size < 2) {
    found.push({
      severity: 'medium',
      title: 'Single-source case',
      detail: `The case rests on ${firsthandAgents.size || 'no'} independent firsthand ${
        firsthandAgents.size === 1 ? 'account' : 'accounts'
      }. A second agent should corroborate before it is concluded.`,
      evidenceIds: graded.filter((item) => item.factors.firsthand).map((item) => item.id)
    })
  }

  const reliableSupport = graded.filter(
    (item) => item.stance === 'supports' && RELIABLE_GRADES.has(item.grade)
  )
  const reliableRefute = graded.filter(
    (item) => item.stance === 'refutes' && RELIABLE_GRADES.has(item.grade)
  )
  if (reliableSupport.length > 0 && reliableRefute.length > 0) {
    found.push({
      severity: 'critical',
      title: 'Conflicting reliable evidence',
      detail: `Grade A–C evidence both supports and refutes the hypothesis. The conflict has to be resolved before a verdict means anything.`,
      evidenceIds: [...reliableSupport, ...reliableRefute].map((item) => item.id)
    })
  }

  const sealedAcquisition = graded.some(
    (item) => item.type === 'acquisition' && item.factors.sealed
  )
  if (graded.length > 0 && !sealedAcquisition) {
    found.push({
      severity: 'medium',
      title: 'No sealed field-unit acquisition',
      detail: `Nothing in the case was pulled off the machine under seal. Deploy the field unit so the physical evidence is tamper-evident.`,
      evidenceIds: []
    })
  }

  if (today) {
    for (const item of graded) {
      if (item.occurredAt && item.occurredAt.slice(0, 10) > today) {
        found.push({
          severity: 'low',
          title: 'Timestamp in the future',
          detail: `${item.title} is dated ${item.occurredAt.slice(0, 10)}, after the current date. Check the source clock.`,
          evidenceIds: [item.id]
        })
      }
    }
  }

  const dated = graded.filter((item) => item.occurredAt && item.stance !== 'neutral')
  outer: for (const a of dated) {
    for (const b of dated) {
      if (a.id >= b.id || a.stance === b.stance) continue
      if ((a.occurredAt as string).slice(0, 10) === (b.occurredAt as string).slice(0, 10)) {
        found.push({
          severity: 'high',
          title: 'Timeline conflict',
          detail: `${a.title} and ${b.title} point to the same day but pull opposite ways. Reconcile the sequence before concluding.`,
          evidenceIds: [a.id, b.id]
        })
        break outer
      }
    }
  }

  found.push(...crossSourceDiscrepancies(graded, context))

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return found.sort((a, b) => order[a.severity] - order[b.severity])
}

const day = (iso: string): string => iso.slice(0, 10)
const CURRENT_NAME = /^i(_a)?$|current|amp/i

/** Checks that only make sense across several pieces of evidence: does the record reach the incident,
 *  can the cabinet explain the spike, are two "same" files really the same, was the key quantity ever
 *  measured. Each carries the step that would resolve it. */
function crossSourceDiscrepancies(graded: readonly GradedEvidence[], context: AssessContext): Discrepancy[] {
  const out: Discrepancy[] = []
  const win = context.incident ?? null

  // 1. A record that stops short of the incident cannot say what happened in it.
  if (win) {
    const wFrom = day(win.from)
    const wTo = day(win.to)
    const windowText = wFrom === wTo ? wFrom : `${wFrom} → ${wTo}`
    for (const e of graded) {
      const cov = e.facts?.coverage
      if (!cov) continue
      const cFrom = day(cov.from)
      const cTo = day(cov.to)
      if (cTo < wFrom || cFrom > wTo) {
        out.push({
          severity: 'high',
          title: 'A record does not cover the incident',
          detail: `${e.title} runs ${cFrom} → ${cTo}; the incident window is ${windowText}. It cannot show what happened in it.`,
          evidenceIds: [e.id],
          action: `Get a record that covers ${windowText}: capture it from the machine with the field unit, or ask the site for that period's file. ${e.title} ends ${cTo}.`
        })
      } else if (cFrom > wFrom || cTo < wTo) {
        out.push({
          severity: 'medium',
          title: 'A record covers only part of the incident',
          detail: `${e.title} runs ${cFrom} → ${cTo}, but the incident window is ${windowText}.`,
          evidenceIds: [e.id]
        })
      }
    }
  }

  // 2. The metered spike against what the cabinet itself can draw.
  const spikes = graded.filter((e) => e.facts?.spike)
  const draws = graded.filter((e) => e.facts?.cabinetKwhPerDay !== undefined)
  for (const s of spikes) {
    for (const d of draws) {
      const spike = s.facts?.spike
      const perDay = d.facts?.cabinetKwhPerDay
      if (!spike || !perDay || perDay <= 0) continue
      const ratio = spike.kwh / perDay
      if (ratio < 20) continue
      const modeled = d.facts?.modeled?.some((c) => /power|current/.test(c))
      out.push({
        severity: 'high',
        title: 'The cabinet’s own draw cannot account for the metered spike',
        detail: `${s.title} records ${spike.kwh} kWh on ${spike.date} against a ${spike.baselineKwh} kWh/day baseline. ${d.title} accounts for about ${perDay} kWh a day${modeled ? ' (a modeled figure)' : ''}, so the spike is roughly ${Math.round(ratio).toLocaleString('en-US')}× the cabinet's whole daily load. Whatever drew that energy was not the cabinet's measured load, or the cabinet's record does not capture it.`,
        evidenceIds: [s.id, d.id],
        action: 'Meter the cabinet’s feed separately from the site supply (a clamp or sub-meter on its circuit), so its draw during an event is measured rather than modeled.'
      })
    }
  }

  // 3. Two different versions of the file with the same name.
  const byName = new Map<string, GradedEvidence[]>()
  for (const e of graded) {
    if (e.facts?.baseName && e.fileSha256) byName.set(e.facts.baseName, [...(byName.get(e.facts.baseName) ?? []), e])
  }
  for (const [name, group] of byName) {
    const hashes = new Set(group.map((e) => e.fileSha256))
    if (hashes.size < 2) continue
    const lines = group.map((e) => `${e.title} (${e.factors.sealed ? 'sealed in an acquisition' : 'unsealed'}, ${(e.fileSha256 as string).slice(0, 10)}…)`)
    out.push({
      severity: 'high',
      title: `Two different versions of ${name} are in the case`,
      detail: `${lines.join('; ')}. They are not the same file, so they cannot both be the machine's record.`,
      evidenceIds: group.map((e) => e.id),
      action: `Decide which ${name} is authoritative. Only the copy captured under seal has proved provenance; ask whoever supplied the other where it came from and when.`
    })
  }

  // 4. A quantity the case depends on was never measured.
  const unmeasured = new Map<string, string[]>()
  for (const e of graded) for (const n of e.facts?.unmeasured ?? []) unmeasured.set(n, [...(unmeasured.get(n) ?? []), e.id])
  const currentNames = [...unmeasured.keys()].filter((n) => CURRENT_NAME.test(n))
  const modeledCurrent = graded.filter((e) => e.facts?.modeled?.some((c) => CURRENT_NAME.test(c)))
  if (currentNames.length > 0) {
    const ids = [...new Set(currentNames.flatMap((n) => unmeasured.get(n) ?? []))]
    out.push({
      severity: 'high',
      title: 'Electric current was never measured',
      detail: `${currentNames.join(', ')} came back with no value in ${ids.length} ${ids.length === 1 ? 'capture' : 'captures'}: the board could not read it, and a missing reading is not a zero.${
        modeledCurrent.length ? ' The cabinet record’s current is a model, not a reading.' : ''
      } With no measured current anywhere in the case, an electrical explanation can be neither confirmed nor excluded.`,
      evidenceIds: ids,
      action: 'Fit a current sensor (a shunt or INA219/INA226 on the 5 V feed, or a clamp meter on the cabinet circuit), feed it to the field unit as I_A, and capture again while the cabinet is active.'
    })
  }
  const otherUnmeasured = [...unmeasured.keys()].filter((n) => !CURRENT_NAME.test(n))
  if (otherUnmeasured.length > 0) {
    out.push({
      severity: 'medium',
      title: `${otherUnmeasured.join(', ')} was never measured`,
      detail: 'The board reported no value for it. It is missing, not zero.',
      evidenceIds: [...new Set(otherUnmeasured.flatMap((n) => unmeasured.get(n) ?? []))]
    })
  }

  // 5. What the analyzers found that matters to the whole case: a broken seal, an excursion, a removed class.
  for (const e of graded) {
    const serious = (e.findings ?? []).filter(
      (f) => (f.severity === 'critical' || f.severity === 'high') && !/never measured|does not cover the incident/i.test(f.title)
    )
    for (const f of serious.slice(0, 3)) {
      out.push({
        severity: f.severity,
        title: `${f.title}`,
        detail: `${e.title}: ${f.detail}`,
        evidenceIds: [e.id],
        action: /seal is broken/i.test(f.title) ? 'Do not rely on this capture. Re-collect it under seal from the machine, and find out how the files came to differ from what the field unit logged.' : undefined
      })
    }
  }
  return out
}

/** A fingerprint of everything an analysis depends on: what each piece of evidence says and how it was
 *  weighed, and the incident window. If it differs from the one stored when analysis last ran, the case
 *  has changed since. */
export function analysisDigest(evidence: readonly Evidence[], incident?: { from: string; to: string } | null): string {
  const rows = evidence
    .map((e) =>
      [
        e.id,
        e.stance,
        e.strength,
        e.factors.sealed ? 1 : 0,
        e.factors.custody ? 1 : 0,
        e.factors.firsthand ? 1 : 0,
        e.factors.timestamped ? 1 : 0,
        e.fileSha256 ?? '',
        e.title
      ].join('|')
    )
    .sort()
  return sha256(`${incident?.from ?? ''}|${incident?.to ?? ''}\n${rows.join('\n')}`)
}

function confidenceLabel(value: number): Confidence {
  return value >= 0.66 ? 'High' : value >= 0.33 ? 'Moderate' : 'Low'
}

/** Weigh the whole investigation into a verdict. `hypothesis` is only used for the returned prose;
 *  the maths is driven by each evidence item's stance, strength and reliability. */
export function assessInvestigation(evidence: readonly Evidence[], today?: string, context: AssessContext = {}): Assessment {
  const graded = gradeAll(evidence)
  const discrepancies = findDiscrepancies(graded, today, context)

  let supportWeight = 0
  let refuteWeight = 0
  for (const item of graded) {
    if (item.stance === 'supports') supportWeight += weightOf(item)
    else if (item.stance === 'refutes') refuteWeight += weightOf(item)
  }
  const decisiveWeight = supportWeight + refuteWeight
  const probability = decisiveWeight === 0 ? null : supportWeight / decisiveWeight

  // Confidence grows with the total weight of decisive evidence and the number of strong (A/B) items,
  // and is cut by unresolved critical or high discrepancies.
  const strongItems = graded.filter((item) => item.grade === 'A' || item.grade === 'B').length
  const seriousDiscrepancies = discrepancies.filter(
    (d) => d.severity === 'critical' || d.severity === 'high'
  ).length
  const confidence = clamp01(
    Math.min(decisiveWeight / 3, 1) * 0.6 +
      (Math.min(strongItems, 3) / 3) * 0.4 -
      seriousDiscrepancies * 0.2
  )
  const label = confidenceLabel(confidence)
  const estimate = probability === null ? null : 0.5 + (probability - 0.5) * confidence

  let verdict: Verdict
  if (probability === null || label === 'Low') verdict = 'inconclusive'
  else if (probability >= 0.66) verdict = 'supported'
  else if (probability <= 0.34) verdict = 'refuted'
  else verdict = 'leaning'

  return {
    graded,
    discrepancies,
    probability,
    estimate,
    confidence,
    confidenceLabel: label,
    verdict,
    nextSteps: buildNextSteps(graded, discrepancies, verdict, label, context, probability),
    supportWeight: round(supportWeight, 2),
    refuteWeight: round(refuteWeight, 2)
  }
}

/** The more-direct steps the platform recommends. When a case is inconclusive these push toward
 *  physical, sealed collection, the field unit and a code diff, exactly the escalation an agent needs. */
function buildNextSteps(
  graded: readonly GradedEvidence[],
  discrepancies: readonly Discrepancy[],
  verdict: Verdict,
  confidence: Confidence,
  context: AssessContext = {},
  probability: number | null = null
): string[] {
  const steps: string[] = []
  // The most direct steps come first: the ones the discrepancies themselves call for.
  for (const d of discrepancies) {
    if (d.action && (d.severity === 'critical' || d.severity === 'high') && !steps.includes(d.action)) steps.push(d.action)
  }
  if (!context.incident && graded.some((e) => e.facts?.coverage)) {
    steps.push('Set the incident window on this case, so the records on file can be weighed for or against the hypothesis.')
  }
  if (graded.length > 0 && probability === null) {
    steps.push('No evidence has been marked as supporting or refuting the hypothesis yet. Review each item’s stance, then analyse again.')
  }
  const has = (type: EvidenceType, sealedOnly = false): boolean =>
    graded.some((item) => item.type === type && (!sealedOnly || item.factors.sealed))

  if (!has('acquisition', true)) {
    steps.push(
      'Deploy the field unit: pull the arcade RPi logs and sensor readings under seal (janus pi all), then import the acquisition here.'
    )
  }
  if (!has('code_diff')) {
    steps.push(
      'Capture the machine game code and diff it against a known-good baseline to show which character class changed or vanished.'
    )
  }
  const firsthandAgents = new Set(
    graded.filter((item) => item.factors.firsthand).map((item) => item.agentId)
  )
  if (firsthandAgents.size < 2) {
    steps.push('Bring in a second agent to corroborate the account independently.')
  }
  if (graded.some((item) => DIGITAL_TYPES.has(item.type) && !item.factors.sealed)) {
    steps.push('Re-collect the unsealed digital items under chain of custody so they become admissible.')
  }
  if (discrepancies.some((d) => d.severity === 'critical')) {
    steps.push('Resolve the conflicting reliable evidence before drawing any conclusion.')
  }
  if (verdict !== 'inconclusive' && confidence === 'High') {
    steps.push('Evidence is sufficient, draft the conclusion report and send it to the case agents.')
  }
  for (const d of discrepancies) {
    if (d.action && d.severity === 'medium' && !steps.includes(d.action)) steps.push(d.action)
  }
  if (steps.length === 0) {
    steps.push('Maintain watch and add evidence as it arrives; re-run the assessment when it does.')
  }
  return steps.slice(0, 8)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function label(type: EvidenceType): string {
  const names: Record<EvidenceType, string> = {
    acquisition: 'a field-unit acquisition',
    code_diff: 'a code diff',
    meter_log: 'a meter log',
    system_log: 'a system log',
    witness: 'a witness account',
    report: 'a report',
    other: 'other evidence'
  }
  return names[type]
}

export const EVIDENCE_TYPE_LABELS: Readonly<Record<EvidenceType, string>> = {
  acquisition: 'Field-unit acquisition',
  code_diff: 'Game-code diff',
  meter_log: 'Meter log',
  system_log: 'System log',
  witness: 'Witness account',
  report: 'Agent report',
  other: 'Other'
}

// ---- Decision support: the single best next action, and a drafted report ----

const VERDICT_PHRASE: Record<Verdict, string> = {
  supported: 'Hypothesis supported',
  refuted: 'Hypothesis refuted',
  leaning: 'Leaning, not yet conclusive',
  inconclusive: 'Inconclusive'
}

/** The one action that would raise confidence the most, with the before/after it buys. */
export interface Lever {
  evidenceId: string | null
  action: string
  fromConfidence: Confidence
  toConfidence: Confidence
  fromProbability: number | null
  toProbability: number | null
  confidenceGain: number
}

/**
 * Sensitivity analysis: simulate the realistic ways the case could be strengthened (seal an unsealed
 * digital item; add a second agent's corroboration) and return whichever lifts confidence the most.
 * This turns "what's wrong" into "do this next, and here is what it buys you".
 */
export function strongestLever(evidence: readonly Evidence[], today?: string, context: AssessContext = {}): Lever | null {
  if (evidence.length === 0) return null
  const current = assessInvestigation(evidence, today, context)
  const worlds: { action: string; evidenceId: string | null; evidence: Evidence[] }[] = []

  evidence.forEach((item, index) => {
    if (DIGITAL_TYPES.has(item.type) && !item.factors.sealed) {
      worlds.push({
        action: `Re-collect "${item.title}" under seal`,
        evidenceId: item.id,
        evidence: evidence.map((e, j) =>
          j === index ? { ...e, factors: { ...e.factors, sealed: true, custody: true } } : e
        )
      })
    }
  })

  const firsthandAgents = new Set(evidence.filter((e) => e.factors.firsthand).map((e) => e.agentId))
  if (firsthandAgents.size < 2) {
    const leaning = current.probability !== null && current.probability < 0.5 ? 'refutes' : 'supports'
    const corroboration: Evidence = {
      id: '__corrob',
      investigationId: evidence[0].investigationId,
      title: 'Second-agent corroboration',
      type: 'witness',
      source: 'second agent',
      agentId: '__second',
      notes: '',
      stance: leaning,
      strength: 2,
      factors: { sealed: false, custody: false, firsthand: true, timestamped: true },
      addedAt: new Date(0).toISOString()
    }
    worlds.push({
      action: "Add a second agent's independent corroboration",
      evidenceId: null,
      evidence: [...evidence, corroboration]
    })
  }

  let best: Lever | null = null
  for (const world of worlds) {
    const next = assessInvestigation(world.evidence, today, context)
    const gain = next.confidence - current.confidence
    if (gain > 0.0001 && (best === null || gain > best.confidenceGain)) {
      best = {
        evidenceId: world.evidenceId,
        action: world.action,
        fromConfidence: current.confidenceLabel,
        toConfidence: next.confidenceLabel,
        fromProbability: current.probability,
        toProbability: next.probability,
        confidenceGain: gain
      }
    }
  }
  return best
}

/** A plain, factual case report derived from the assessment, a starting draft the agent edits. */
export function buildCaseReport(
  input: { title: string; hypothesis: string; incident?: { from: string; to: string } | null },
  assessment: Assessment,
  today = new Date().toISOString().slice(0, 10)
): string {
  const pct = assessment.estimate === null ? 'n/a' : `${Math.round(assessment.estimate * 100)}%`
  const lines: string[] = [input.title, '']
  lines.push(
    `Verdict: ${VERDICT_PHRASE[assessment.verdict]} (${pct}, ${assessment.confidenceLabel.toLowerCase()} confidence).`
  )
  if (input.hypothesis) lines.push('', `Hypothesis under test: ${input.hypothesis}`)
  if (input.incident) lines.push(`Incident window: ${input.incident.from === input.incident.to ? input.incident.from : `${input.incident.from} to ${input.incident.to}`}`)

  lines.push('', `Evidence on file (${assessment.graded.length}):`)
  for (const e of assessment.graded) {
    lines.push(
      `  [${e.grade}] ${e.title} - ${EVIDENCE_TYPE_LABELS[e.type].toLowerCase()}, ${e.agentId}, ${
        e.factors.sealed ? 'sealed' : 'unsealed'
      }, ${e.stance}.`
    )
  }

  if (assessment.discrepancies.length > 0) {
    lines.push('', 'Discrepancies:')
    for (const d of assessment.discrepancies) lines.push(`  (${d.severity}) ${d.title}. ${d.detail}`)
  }

  if (assessment.nextSteps.length > 0) {
    lines.push('', 'Recommended next steps:')
    assessment.nextSteps.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`))
  }

  lines.push(
    '',
    `Prepared ${today} by Janus. Derived from the sealed evidence on file and re-derivable from it.`
  )
  return lines.join('\n')
}

// ---- Analysis of Competing Hypotheses (ACH) ----
// Rather than scoring one hypothesis, rate every piece of evidence against several explanations and
// rank them by how much reliable evidence is INCONSISTENT with each. The least-contradicted explanation
// wins, the disconfirmation logic real analysts use to fight confirmation bias.

export type AchRating = 'CC' | 'C' | 'N' | 'I' | 'II' // very consistent → neutral → very inconsistent

export interface Hypothesis {
  id: string
  label: string
}

export const DEFAULT_HYPOTHESES: readonly Hypothesis[] = [
  { id: 'breach', label: 'Extradigital breach (a character escaped)' },
  { id: 'coverup', label: 'Cover-up / records tampered' },
  { id: 'malfunction', label: 'Hardware or software malfunction' },
  { id: 'hoax', label: 'Hoax or misread' }
]

export const ACH_RATING_LABELS: Readonly<Record<AchRating, string>> = {
  CC: 'Strongly consistent',
  C: 'Consistent',
  N: 'Neutral / N.A.',
  I: 'Inconsistent',
  II: 'Strongly inconsistent'
}

const ACH_PENALTY: Record<AchRating, number> = { CC: 0, C: 0, N: 0, I: 1, II: 2 }
const ACH_SUPPORT: Record<AchRating, number> = { CC: 2, C: 1, N: 0, I: 0, II: 0 }

export interface RankedHypothesis {
  id: string
  label: string
  rank: number
  inconsistency: number // weighted, higher = more contradicted
  support: number // weighted consistent evidence
  likelihood: number // 0–1, normalised across hypotheses
  inconsistentCount: number
}

export interface AchResult {
  hypotheses: RankedHypothesis[]
  diagnostic: string[] // evidence ids that discriminate between hypotheses (the valuable ones)
  rated: number // how many evidence items carry ratings
}

/** Rank hypotheses by weighted inconsistency (reliable contradicting evidence counts most). */
export function analyzeACH(hypotheses: readonly Hypothesis[], evidence: readonly Evidence[]): AchResult {
  const graded = gradeAll(evidence)
  const rated = graded.filter((e) => e.consistency && Object.keys(e.consistency).length > 0)

  const rows = hypotheses.map((h) => {
    let inconsistency = 0
    let support = 0
    let inconsistentCount = 0
    for (const e of rated) {
      const rating = e.consistency?.[h.id] ?? 'N'
      const weight = e.score / 100
      inconsistency += ACH_PENALTY[rating] * weight
      support += ACH_SUPPORT[rating] * weight
      if (rating === 'I' || rating === 'II') inconsistentCount++
    }
    return { id: h.id, label: h.label, inconsistency, support, inconsistentCount }
  })

  // Likelihood favours the least-contradicted, then the best-supported. Normalise to sum 1.
  const raw = rows.map((r) => ({ ...r, raw: Math.max(0.01, 1 / (1 + r.inconsistency) + r.support * 0.15) }))
  const total = raw.reduce((s, r) => s + r.raw, 0) || 1
  const ranked = raw
    .map((r) => ({ id: r.id, label: r.label, inconsistency: round2(r.inconsistency), support: round2(r.support), inconsistentCount: r.inconsistentCount, likelihood: r.raw / total, rank: 0 }))
    .sort((a, b) => a.inconsistency - b.inconsistency || b.support - a.support)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  // Diagnostic evidence: ratings that differ across hypotheses actually discriminate.
  const diagnostic = rated
    .filter((e) => {
      const vals = hypotheses.map((h) => e.consistency?.[h.id] ?? 'N')
      return new Set(vals).size > 1
    })
    .map((e) => e.id)

  return { hypotheses: ranked, diagnostic, rated: rated.length }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---- Incident timeline ----
// Reconstruct the sequence of the incident from evidence that carries an event time.

export interface TimelineEntry {
  id: string
  title: string
  when: string
  day: string
  type: EvidenceType
  grade: Grade
  stance: Stance
}

export interface CaseTimeline {
  entries: TimelineEntry[] // dated, in order
  undated: { id: string; title: string; grade: Grade }[]
  span: { from: string; to: string } | null
}

export function caseTimeline(evidence: readonly Evidence[]): CaseTimeline {
  const graded = gradeAll(evidence)
  const dated = graded
    .filter((e) => e.occurredAt)
    .map((e) => ({
      id: e.id,
      title: e.title,
      when: e.occurredAt as string,
      day: (e.occurredAt as string).slice(0, 10),
      type: e.type,
      grade: e.grade,
      stance: e.stance
    }))
    .sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0))
  const undated = graded.filter((e) => !e.occurredAt).map((e) => ({ id: e.id, title: e.title, grade: e.grade }))
  const span = dated.length ? { from: dated[0].when, to: dated[dated.length - 1].when } : null
  return { entries: dated, undated, span }
}
