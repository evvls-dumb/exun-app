// Reader for an electricity meter ledger dropped as a file (CSV, TSV or JSON). It maps whatever column
// names the file uses onto the app's own MeterEntry shape, then reuses the same analysis the Home view
// runs (spike against baseline, log-versus-meter mismatch), so a ledger is judged one way everywhere.

import type { EvidenceFacts, Finding } from './evidence'
import { analyseLog, round1, type Analysis, type MeterEntry } from './meter'
import type { IncidentWindow, Suggestion } from './januslog'

/** What a stance suggestion needs from a ledger, kept with the evidence so it can be re-derived. */
export interface LedgerProfile {
  kind: 'ledger'
  first: string
  last: string
  spikeDates: string[]
}

export interface LedgerRead {
  entries: MeterEntry[]
  derived: string[] // columns the file did not have and we had to derive
  problems: string[]
}

export interface LedgerAnalysis {
  analysis: Analysis
  read: LedgerRead
  summary: string[]
  findings: Finding[]
  facts: EvidenceFacts
  profile: LedgerProfile
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/

function splitRow(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/** Read a meter ledger. Returns null when the text does not look like one (so other readers can try). */
export function readLedger(text: string): LedgerRead | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  let rows: Record<string, unknown>[] = []
  if (trimmed[0] === '[' || trimmed[0] === '{') {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { entries?: unknown }).entries) ? (parsed as { entries: unknown[] }).entries : null
      if (!list) return null
      rows = list.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    } catch {
      return null
    }
  } else {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== '')
    if (lines.length < 2) return null
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
    const columns = splitRow(lines[0], sep).map((c) => c.toLowerCase())
    for (const line of lines.slice(1)) {
      const cells = splitRow(line, sep)
      const row: Record<string, unknown> = {}
      columns.forEach((c, i) => (row[c] = cells[i]))
      rows.push(row)
    }
  }
  if (rows.length === 0) return null

  const keys = Object.keys(rows[0]).map((k) => k.toLowerCase())
  const kDate = keys.find((k) => /^(date|day|timestamp|time)$/.test(k)) ?? keys.find((k) => /date|day/.test(k))
  const kReading = keys.find((k) => /(reading|cumulative|meter)/.test(k) && !/usage/.test(k))
  const kUsage = keys.find((k) => /(usage|consumption|used|energy|kwh)/.test(k) && k !== kReading)
  if (!kDate || (!kReading && !kUsage)) return null

  const problems: string[] = []
  const derived: string[] = []
  const entries: MeterEntry[] = []
  const get = (row: Record<string, unknown>, key: string): unknown => {
    const hit = Object.keys(row).find((k) => k.toLowerCase() === key)
    return hit ? row[hit] : undefined
  }
  for (const row of rows) {
    const d = String(get(row, kDate) ?? '').trim()
    if (!DATE_RE.test(d)) {
      problems.push(`skipped a row with date "${d}"`)
      continue
    }
    const reading = kReading ? Number(String(get(row, kReading)).replace(/,/g, '')) : NaN
    const usage = kUsage ? Number(String(get(row, kUsage)).replace(/,/g, '')) : NaN
    entries.push({ date: d.slice(0, 10), reading, usage })
  }
  if (entries.length < 3) return null
  entries.sort((a, b) => (a.date < b.date ? -1 : 1))

  if (!kReading) {
    derived.push('reading')
    let running = 0
    for (const e of entries) {
      running += Number.isFinite(e.usage) ? e.usage : 0
      e.reading = round1(running)
    }
  }
  if (!kUsage) {
    derived.push('usage')
    entries.forEach((e, i) => {
      e.usage = i === 0 ? NaN : round1(e.reading - entries[i - 1].reading)
    })
    entries[0].usage = entries[1]?.usage ?? 0
  }
  const clean = entries.filter((e) => Number.isFinite(e.reading) && Number.isFinite(e.usage))
  if (clean.length < 3) return null
  return { entries: clean, derived, problems }
}

export function analyseLedger(read: LedgerRead, today: string): LedgerAnalysis {
  const analysis = analyseLog(today, read.entries)
  const findings: Finding[] = []
  const facts: EvidenceFacts = {}
  const first = read.entries[0].date
  const last = read.entries[read.entries.length - 1].date
  facts.coverage = { from: first, to: last }

  const summary = [`${read.entries.length} daily readings · ${first} → ${last}`]
  const spikes = analysis.days.filter((d) => d.spike)
  const peak = analysis.peak
  if (spikes.length > 0) {
    facts.spike = { date: peak.date, kwh: round1(peak.usage), baselineKwh: round1(analysis.baseline) }
    findings.push({
      severity: 'high',
      title: `Usage spike on ${peak.date}`,
      detail: `${round1(peak.usage)} kWh against a baseline of ${round1(analysis.baseline)} kWh/day, ${round1(analysis.peakFactor)}× normal${spikes.length > 1 ? `; ${spikes.length} spiking days in all` : ''}.`
    })
    summary.push(`Peak ${round1(peak.usage)} kWh on ${peak.date} (${round1(analysis.peakFactor)}× baseline)`)
  } else {
    summary.push('No usage spike against the ledger’s own baseline')
  }
  const mismatches = analysis.days.filter((d) => d.mismatch)
  if (mismatches.length > 0) {
    findings.push({
      severity: 'high',
      title: `${mismatches.length} ${mismatches.length === 1 ? 'day' : 'days'} where the logged usage does not match the meter`,
      detail: mismatches.slice(0, 6).map((d) => d.date).join(', ') + ', the usage written down differs from the change in the cumulative reading.'
    })
  }
  const future = analysis.days.filter((d) => d.future)
  if (future.length > 0) {
    findings.push({ severity: 'low', title: 'Future-dated rows', detail: future.map((d) => d.date).join(', ') })
  }
  if (read.derived.length > 0) {
    findings.push({
      severity: 'low',
      title: `The ${read.derived.join(' and ')} column was derived`,
      detail: 'The file did not contain it, so the cross-check between logged usage and the meter reading is not independent.'
    })
  }
  if (read.problems.length > 0) {
    findings.push({ severity: 'low', title: 'Some rows were skipped', detail: read.problems.slice(0, 4).join('; ') })
  }

  const profile: LedgerProfile = { kind: 'ledger', first, last, spikeDates: spikes.map((d) => d.date) }
  return { analysis, read, summary, findings, facts, profile }
}

/** Weigh a meter ledger against an incident window. Pure: re-run whenever the window changes. */
export function suggestForLedger(profile: LedgerProfile, incident: IncidentWindow | null | undefined): Suggestion {
  if (!incident) {
    return {
      stance: 'neutral',
      strength: 1,
      reason: 'No incident window is set on this case, so the ledger cannot yet be weighed for or against the hypothesis.'
    }
  }
  const from = incident.from.slice(0, 10)
  const to = incident.to.slice(0, 10)
  const covers = profile.first <= to && profile.last >= from
  if (!covers) {
    return {
      stance: 'neutral',
      strength: 1,
      reason: `The ledger runs ${profile.first} → ${profile.last}, which does not include the incident window.`
    }
  }
  if (profile.spikeDates.some((d) => d >= from && d <= to)) {
    return { stance: 'supports', strength: 3, reason: 'A usage spike falls inside the incident window.' }
  }
  return { stance: 'refutes', strength: 2, reason: 'The ledger covers the incident window and shows no spike in it.' }
}
