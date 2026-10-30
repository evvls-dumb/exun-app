// Reader and analyzer for the arcade cabinet's own record: the JANUS-LOG/1 text file (logs.janus).
//
// The field unit copies this file off the Raspberry Pi as an item inside a sealed acquisition. Here it
// is parsed into tables and checked for what an investigator would ask of it:
//   - does it cover the incident, or stop short of it?
//   - are there electrical excursions, and are the electrical numbers measured at all?
//   - does it say where it came from, and is that origin real or synthetic?
//   - is it internally consistent (gaps, duplicates, state/runtime mismatches)?
//
// The analysis is generic. It uses robust statistics against the cabinet's own history plus a few hard
// engineering limits, and it never assumes what the incident was. Pure and deterministic: no clock, no
// Electron, no file access, so the same file always yields the same findings.

import type { EvidenceFacts, Finding } from './evidence'

export interface LogTable {
  columns: string[]
  rows: string[][]
}

export interface ParsedJanusLog {
  format: string
  header: Record<string, string>
  tables: Record<string, LogTable>
  journal: string[]
}

export interface IncidentWindow {
  from: string // ISO date (whole day) or date-time
  to: string
}

export interface WindowCheck {
  covered: 'full' | 'partial' | 'none'
  rowsInside: number
  excursionsInside: number
  note: string
}

export interface Suggestion {
  stance: 'supports' | 'refutes' | 'neutral'
  strength: 1 | 2 | 3
  reason: string
}

/** The compact facts a stance suggestion needs, kept with the evidence so it can be re-derived whenever
 *  the incident window changes, without the original file. */
export interface TelemetryProfile {
  kind: 'telemetry'
  first: string
  last: string
  stepMs: number
  offsetMinutes: number
  /** Timestamps of hourly readings flagged as excursions (capped). */
  flaggedAt: string[]
  /** True when the electrical figures are estimates, so a clean record refutes only weakly. */
  estimatedElectrical: boolean
}

export interface TelemetryAnalysis {
  summary: string[]
  findings: Finding[]
  facts: EvidenceFacts
  profile: TelemetryProfile | null
  /** Excursion events found, for display and for the case report. */
  events: ExcursionEvent[]
  rows: number
}

export interface ExcursionEvent {
  series: string
  state: string
  from: string
  to: string
  peak: number
  median: number
  hours: number
}

const BEGIN = /^===== BEGIN ([A-Z0-9_]+) =====\s*$/
const END = /^===== END ([A-Z0-9_]+) =====\s*$/

/** True when the text opens like a JANUS-LOG file. Cheap enough to call on every dropped text file. */
export function looksLikeJanusLog(text: string): boolean {
  return /^\s*file_format\s*=\s*JANUS-LOG\/\d+/.test(text.slice(0, 200))
}

export function parseJanusLog(text: string): ParsedJanusLog | null {
  if (!looksLikeJanusLog(text)) return null
  const header: Record<string, string> = {}
  const tables: Record<string, LogTable> = {}
  const journal: string[] = []
  let format = ''
  let section: string | null = null
  let table: LogTable | null = null

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (section === null) {
      const begin = BEGIN.exec(line)
      if (begin) {
        section = begin[1]
        table = null
        continue
      }
      const eq = line.indexOf('=')
      if (eq > 0) header[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
      continue
    }
    if (END.test(line)) {
      section = null
      table = null
      continue
    }
    if (line === '') continue
    if (section === 'SYSTEM_JOURNAL') {
      journal.push(line)
      continue
    }
    if (table === null) {
      table = { columns: line.split(','), rows: [] }
      tables[section] = table
    } else {
      table.rows.push(line.split(','))
    }
  }
  format = header['file_format'] ?? ''
  return { format, header, tables, journal }
}

// ---- time helpers ---------------------------------------------------------------------------------

/** Minutes east of UTC from the offset written on a timestamp ("…+05:30" → 330). 0 when none is written. */
export function offsetMinutesOf(timestamp: string): number {
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(timestamp)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** Turn an incident window into epoch milliseconds. A bare date means that whole calendar day in the
 *  record's own time zone, which is how the person who wrote the window thinks about it. */
export function windowToEpoch(window: IncidentWindow, offsetMinutes: number): { from: number; to: number } | null {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const zone = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  const edge = (value: string, end: boolean): number => {
    const v = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(`${v}T${end ? '23:59:59.999' : '00:00:00'}${zone}`)
    return Date.parse(v)
  }
  const from = edge(window.from, false)
  const to = edge(window.to, true)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return { from, to }
}

// ---- robust statistics ----------------------------------------------------------------------------

function medianOf(sorted: number[]): number {
  const n = sorted.length
  if (n === 0) return NaN
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

function robust(values: number[]): { median: number; scale: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const median = medianOf(sorted)
  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b)
  return { median, scale: 1.4826 * medianOf(deviations) }
}

const round = (n: number, places = 2): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

// A 5 V USB-C rail is specified at 5 V ± 5 %. Outside this the supply is out of tolerance whatever the
// cabinet's history says. Raspberry Pi SoCs begin to throttle at 80 °C.
export const RAIL_MIN_V = 4.75
export const RAIL_MAX_V = 5.25
export const THROTTLE_TEMP_C = 80
const OUTLIER_Z = 6

const SERIES = [
  { column: 'five_v_rail_est_v', label: '5 V rail', unit: 'V', digits: 3 },
  { column: 'estimated_current_a', label: 'current', unit: 'A', digits: 2 },
  { column: 'estimated_power_w', label: 'power', unit: 'W', digits: 2 },
  { column: 'cpu_temp_c', label: 'CPU temperature', unit: '°C', digits: 1 }
] as const

function index(table: LogTable | undefined, name: string): number {
  return table ? table.columns.indexOf(name) : -1
}

function dateLabel(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

/** Columns that are estimates or models, by the file's own naming and its telemetry_note. */
function modeledColumns(table: LogTable, note: string): string[] {
  const names = new Set<string>()
  for (const column of table.columns) {
    if (/^estimated_/.test(column) || /_est(_|$)/.test(column)) names.add(column)
  }
  for (const column of table.columns) {
    if (note && new RegExp(`\\b${column}\\b`).test(note) && /model|estimat|not direct|not measured/i.test(note)) {
      names.add(column)
    }
  }
  return [...names]
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

/** Weigh a telemetry record against an incident window. Pure: re-run whenever the window changes. */
export function suggestForTelemetry(
  profile: TelemetryProfile,
  incident: IncidentWindow | null | undefined
): { check: WindowCheck | null; suggestion: Suggestion } {
  const range = incident ? windowToEpoch(incident, profile.offsetMinutes) : null
  if (!range || !incident) {
    return {
      check: null,
      suggestion: {
        stance: 'neutral',
        strength: 1,
        reason: 'No incident window is set on this case, so the record cannot yet be weighed for or against the hypothesis.'
      }
    }
  }
  const first = Date.parse(profile.first)
  const last = Date.parse(profile.last)
  const flaggedInside = profile.flaggedAt.filter((t) => {
    const e = Date.parse(t)
    return e >= range.from && e <= range.to
  }).length
  // Readings inside the window, counted from the regular step the record keeps.
  const rowsInside = Math.max(
    0,
    Math.floor((Math.min(range.to, last) - Math.max(range.from, first)) / profile.stepMs) + 1
  )
  const noOverlap = range.to < first || range.from > last
  // Each reading stands for the interval that follows it, so the record spans [first, last + step).
  const covered: WindowCheck['covered'] =
    noOverlap || rowsInside === 0
      ? 'none'
      : range.from >= first && range.to < last + profile.stepMs
        ? 'full'
        : 'partial'
  let note: string
  if (covered === 'none') {
    note =
      range.from > last
        ? `The record ends ${profile.last}, before the incident window begins (${incident.from}). It cannot show what happened.`
        : `The record starts ${profile.first}, after the incident window (${incident.to}).`
  } else if (covered === 'partial') {
    note = `The record covers only part of the incident window (about ${rowsInside} hourly readings fall inside it).`
  } else {
    note = `About ${rowsInside} hourly readings fall inside the incident window; ${flaggedInside} flagged.`
  }
  const check: WindowCheck = { covered, rowsInside: covered === 'none' ? 0 : rowsInside, excursionsInside: flaggedInside, note }
  if (covered === 'none') return { check, suggestion: { stance: 'neutral', strength: 1, reason: note } }
  if (flaggedInside > 0) {
    return {
      check,
      suggestion: {
        stance: 'supports',
        strength: profile.estimatedElectrical ? 2 : 3,
        reason: `Flagged hours inside the incident window: ${flaggedInside}.`
      }
    }
  }
  const base = profile.estimatedElectrical ? 1 : 2
  return {
    check,
    suggestion: {
      stance: 'refutes',
      strength: (covered === 'partial' ? Math.max(1, base - 1) : base) as 1 | 2,
      reason: `The record covers the window and shows nothing abnormal${
        profile.estimatedElectrical ? ', but its electrical figures are modeled, so this refutes only weakly' : ''
      }.`
    }
  }
}

export function analyseJanusLog(parsed: ParsedJanusLog): TelemetryAnalysis {
  const findings: Finding[] = []
  const summary: string[] = []
  const facts: EvidenceFacts = {}
  const hourly = parsed.tables['HOURLY_TELEMETRY']
  const header = parsed.header

  const machineTitle = header['machine_title'] ?? header['machine_id'] ?? 'unknown machine'
  facts.machine = [header['machine_id'], header['machine_title']].filter(Boolean).join(' · ') || undefined
  summary.push(`${machineTitle}${header['site'] ? `, ${header['site']}` : ''}`)

  // ---- provenance --------------------------------------------------------------------------------
  const origin = header['record_origin']
  if (origin) {
    facts.declaredOrigin = origin
    if (/synthetic|fictional|simulat|demo|generated/i.test(origin)) {
      findings.push({
        severity: 'medium',
        title: 'The record declares itself synthetic',
        detail: `Its own header says record_origin=${origin}. It describes the scenario; it is not a measurement taken from a live cabinet, so it cannot prove what the hardware did.`
      })
    }
  } else {
    findings.push({
      severity: 'low',
      title: 'The record does not state where it came from',
      detail: 'There is no record_origin in the header. Ask whoever supplied it whether it is device-native or generated.'
    })
  }

  if (!hourly || hourly.rows.length === 0) {
    findings.push({
      severity: 'high',
      title: 'No hourly telemetry in the file',
      detail: 'The HOURLY_TELEMETRY section is missing or empty, so the electrical record cannot be checked.'
    })
    return { summary, findings, facts, events: [], rows: 0, profile: null }
  }

  const iTime = index(hourly, 'timestamp')
  const iState = index(hourly, 'cabinet_state')
  const iThrottle = index(hourly, 'throttled_flag')
  const iRuntime = index(hourly, 'game_runtime_active')
  const times = hourly.rows.map((r) => r[iTime] ?? '')
  const epoch = times.map((t) => Date.parse(t))
  const offset = offsetMinutesOf(times[0] ?? '')

  // ---- coverage and integrity of the time axis ---------------------------------------------------
  const first = times[0]
  const last = times[times.length - 1]
  facts.coverage = { from: first, to: last }
  summary.push(`${plural(hourly.rows.length, 'hourly reading')} · ${dateLabel(first)} → ${dateLabel(last)}`)

  const declaredFrom = header['period_start']
  const declaredTo = header['period_end']
  if ((declaredFrom && declaredFrom !== first) || (declaredTo && declaredTo !== last)) {
    findings.push({
      severity: 'medium',
      title: 'Declared period does not match the data',
      detail: `The header declares ${declaredFrom ?? '?'} → ${declaredTo ?? '?'}, but the readings run ${first} → ${last}.`
    })
  }

  let gaps = 0
  let duplicates = 0
  let backwards = 0
  const step = (() => {
    const deltas: number[] = []
    for (let i = 1; i < epoch.length && deltas.length < 2000; i++) deltas.push(epoch[i] - epoch[i - 1])
    return medianOf(deltas.sort((a, b) => a - b))
  })()
  for (let i = 1; i < epoch.length; i++) {
    const delta = epoch[i] - epoch[i - 1]
    if (delta === 0) duplicates++
    else if (delta < 0) backwards++
    else if (step > 0 && delta > step * 1.5) gaps++
  }
  if (gaps + duplicates + backwards > 0) {
    findings.push({
      severity: gaps > 0 || backwards > 0 ? 'high' : 'medium',
      title: 'The time axis has breaks',
      detail: `${plural(gaps, 'gap')}, ${plural(duplicates, 'duplicate timestamp')} and ${plural(backwards, 'out-of-order row')} in the hourly readings. A record with holes cannot rule out what happened inside them.`
    })
  }

  // ---- modeled vs measured -----------------------------------------------------------------------
  const note = header['telemetry_note'] ?? ''
  const modeled = modeledColumns(hourly, note)
  if (modeled.length > 0) {
    facts.modeled = modeled
    const electrical = modeled.filter((c) => /current|power|five_v|rail|volt/.test(c))
    if (electrical.length > 0) {
      findings.push({
        severity: 'medium',
        title: 'The electrical figures are estimates, not measurements',
        detail: `${electrical.join(', ')} ${electrical.length === 1 ? 'is' : 'are'} labelled as estimated or modeled${note ? ` ("${note}")` : ''}. Nothing in this file is a direct reading of voltage or current, so it cannot confirm or exclude an electrical anomaly on its own.`
      })
    }
  }

  // ---- excursions: the cabinet against its own history, plus hard limits -------------------------
  const events: ExcursionEvent[] = []
  const flagged = new Uint8Array(hourly.rows.length)
  for (const series of SERIES) {
    const c = index(hourly, series.column)
    if (c < 0) continue
    const byState = new Map<string, number[]>()
    hourly.rows.forEach((row, i) => {
      const state = iState >= 0 ? row[iState] : 'all'
      const v = Number(row[c])
      if (!Number.isFinite(v)) return
      if (!byState.has(state)) byState.set(state, [])
      byState.get(state)?.push(i)
    })
    for (const [state, rowIndexes] of byState) {
      const values = rowIndexes.map((i) => Number(hourly.rows[i][c]))
      const { median, scale } = robust(values)
      // A floor on the scale stops a perfectly flat series from flagging rounding noise.
      const floor = Math.max(scale, Math.abs(median) * 0.005, 1e-6)
      let run: { from: number; to: number; peak: number } | null = null
      const close = () => {
        if (!run) return
        events.push({
          series: series.label,
          state,
          from: times[run.from],
          to: times[run.to],
          peak: run.peak,
          median: round(median, series.digits),
          hours: run.to - run.from + 1
        })
        run = null
      }
      for (const i of rowIndexes) {
        const v = Number(hourly.rows[i][c])
        const hard =
          (series.column === 'five_v_rail_est_v' && (v < RAIL_MIN_V || v > RAIL_MAX_V)) ||
          (series.column === 'cpu_temp_c' && v >= THROTTLE_TEMP_C)
        const outlier = Math.abs(v - median) / floor > OUTLIER_Z
        if (hard || outlier) {
          flagged[i] = 1
          if (run && i - run.to <= 1) {
            run.to = i
            if (Math.abs(v - median) > Math.abs(run.peak - median)) run.peak = v
          } else {
            close()
            run = { from: i, to: i, peak: v }
          }
        } else {
          close()
        }
      }
      close()
    }
  }

  let throttled = 0
  let stateMismatch = 0
  hourly.rows.forEach((row, i) => {
    if (iThrottle >= 0 && Number(row[iThrottle]) !== 0) {
      throttled++
      flagged[i] = 1
    }
    if (iState >= 0 && iRuntime >= 0) {
      const state = row[iState]
      const running = row[iRuntime] === '1'
      if ((state === 'standby' && running) || (state === 'active' && !running)) {
        stateMismatch++
        flagged[i] = 1
      }
    }
  })

  const excursionHours = flagged.reduce((a, b) => a + b, 0)
  if (events.length === 0 && throttled === 0 && stateMismatch === 0) {
    findings.push({
      severity: 'low',
      title: 'No excursions in the record',
      detail: `Across ${plural(hourly.rows.length, 'hourly reading')} the 5 V rail, current, power and CPU temperature stayed inside the cabinet's own normal range for each state, with no throttling and no runtime/state mismatches.`
    })
    summary.push('No electrical, thermal or runtime excursions')
  } else {
    const top = [...events].sort((a, b) => Math.abs(b.peak - b.median) - Math.abs(a.peak - a.median)).slice(0, 5)
    findings.push({
      severity: 'high',
      title: `${plural(events.length + (throttled ? 1 : 0) + (stateMismatch ? 1 : 0), 'excursion event')} found`,
      detail:
        top
          .map((e) => `${e.series} ${e.peak} (normal ${e.median}) from ${dateLabel(e.from)}, ${plural(e.hours, 'hour')}`)
          .join('; ') +
        (throttled ? `; throttled in ${plural(throttled, 'hour')}` : '') +
        (stateMismatch ? `; runtime disagrees with cabinet state in ${plural(stateMismatch, 'hour')}` : '') +
        '.'
    })
    summary.push(`${plural(excursionHours, 'hour')} flagged`)
  }

  // ---- what the cabinet itself draws -------------------------------------------------------------
  const iPower = index(hourly, 'estimated_power_w')
  if (iPower >= 0) {
    const wattHours = hourly.rows.reduce((sum, r) => sum + (Number(r[iPower]) || 0), 0)
    const hours = hourly.rows.length * (step > 0 ? step / 3_600_000 : 1)
    const perDay = (wattHours / 1000 / hours) * 24
    if (Number.isFinite(perDay)) {
      facts.cabinetKwhPerDay = round(perDay, 3)
      summary.push(`Cabinet draws about ${round(perDay, 2)} kWh/day (modeled)`)
    }
  }

  // ---- the other sections: journal, thermal, power monitor, daily activity ----------------------
  const journalWarn = parsed.journal.filter((l) => /\[(WARN|ERROR|CRIT|ALERT|EMERG)\]/.test(l))
  const unexplainedRestarts = parsed.journal.filter(
    (l) => /Monitoring services started/.test(l) && !/reason=(monthly-watchdog-test|scheduled-maintenance)/.test(l)
  )
  if (unexplainedRestarts.length > 0) {
    findings.push({
      severity: 'high',
      title: `${plural(unexplainedRestarts.length, 'restart')} with no scheduled reason`,
      detail: unexplainedRestarts
        .slice(0, 3)
        .map((l) => l.slice(0, 120))
        .join(' | ')
    })
  }
  if (parsed.journal.length > 0) {
    summary.push(`${plural(parsed.journal.length, 'journal line')}, ${plural(journalWarn.length, 'warning')}`)
  }

  const power = parsed.tables['POWER_MONITOR_EVENTS']
  if (power) {
    const iStatus = index(power, 'status')
    const bad = power.rows.filter((r) => iStatus >= 0 && r[iStatus] !== 'voltage_within_operating_range')
    if (bad.length > 0) {
      findings.push({
        severity: 'high',
        title: `${plural(bad.length, 'power-monitor alert')}`,
        detail: bad
          .slice(0, 3)
          .map((r) => r.join(' '))
          .join(' | ')
      })
    }
  }
  const daily = parsed.tables['CABINET_DAILY_ACTIVITY']
  if (daily) {
    const iStatus = index(daily, 'status')
    const notOperational = daily.rows.filter((r) => iStatus >= 0 && r[iStatus] !== 'operational')
    if (notOperational.length > 0) {
      findings.push({
        severity: 'medium',
        title: `${plural(notOperational.length, 'day')} not marked operational`,
        detail: notOperational
          .slice(0, 5)
          .map((r) => `${r[0].slice(0, 10)} ${r[iStatus]}`)
          .join('; ')
      })
    }
  }

  const estimatedElectrical = (facts.modeled ?? []).some((c) => /current|power|five_v|rail|volt/.test(c))
  const flaggedAt: string[] = []
  for (let i = 0; i < flagged.length && flaggedAt.length < 5000; i++) if (flagged[i]) flaggedAt.push(times[i])
  const profile: TelemetryProfile = {
    kind: 'telemetry',
    first,
    last,
    stepMs: step > 0 ? step : 3_600_000,
    offsetMinutes: offset,
    flaggedAt,
    estimatedElectrical
  }

  return { summary, findings, facts, profile, events, rows: hourly.rows.length }
}
