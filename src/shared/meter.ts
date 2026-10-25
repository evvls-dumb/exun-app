import { formatNumber } from './format'

export interface MeterEntry {
  date: string
  reading: number
  usage: number
}

export const METER_LOG: readonly MeterEntry[] = [
  { date: '2026-10-13', reading: 18477.2, usage: 24.6 },
  { date: '2026-10-14', reading: 18505.3, usage: 28.1 },
  { date: '2026-10-15', reading: 18528.2, usage: 22.9 },
  { date: '2026-10-16', reading: 18559.6, usage: 31.4 },
  { date: '2026-10-17', reading: 18586.3, usage: 26.7 },
  { date: '2026-10-18', reading: 18621.5, usage: 35.2 },
  { date: '2026-10-19', reading: 18651.3, usage: 29.8 },
  { date: '2026-10-20', reading: 18674.8, usage: 23.5 },
  { date: '2026-10-21', reading: 18702.4, usage: 27.6 },
  { date: '2026-10-22', reading: 18727.5, usage: 25.1 },
  { date: '2026-10-23', reading: 21411.5, usage: 2684 },
  { date: '2026-10-24', reading: 21442.2, usage: 503.2 },
  { date: '2026-10-25', reading: 21464, usage: 21.8 },
  { date: '2026-10-26', reading: 21492.9, usage: 28.9 }
]

export const SPIKE_FACTOR = 5
export const MISMATCH_TOLERANCE_KWH = 0.5
export const HOURS_PER_DAY = 24
const MS_PER_DAY = 86_400_000

export type Tone = 'normal' | 'critical' | 'high' | 'medium'

export interface DayRecord extends MeterEntry {
  delta: number | null
  spike: boolean
  mismatch: boolean
  future: boolean
}

export interface TimelineEvent {
  date: string
  endDate?: string
  tone: Tone
  title: string
  detail: string
}

export interface Check {
  passed: boolean
  label: string
}

export interface Analysis {
  days: DayRecord[]
  baseline: number
  peak: DayRecord
  peakFactor: number
  peakLoadKw: number
  baselineLoadKw: number
  excessKwh: number
  ledgerGapKwh: number
  meteredKwh: number
  loggedKwh: number
  projected: (number | null)[]
  projectionGapKwh: number
  counts: Record<Exclude<Tone, 'normal'>, number>
  timeline: TimelineEvent[]
  checks: Check[]
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function isIncident(day: DayRecord): boolean {
  return day.spike || day.mismatch
}

export function isFlagged(day: DayRecord): boolean {
  return isIncident(day) || day.future
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function describe(day: DayRecord, baseline: number, beforeIncident: boolean): TimelineEvent {
  const used = day.delta ?? day.usage

  if (day.spike) {
    return {
      date: day.date,
      tone: 'critical',
      title: 'Consumption spike',
      detail: `Meter jumped ${formatNumber(used)} kWh, ${Math.round(used / baseline)}× baseline`
    }
  }
  if (day.mismatch) {
    return {
      date: day.date,
      tone: 'high',
      title: 'Log doesn’t match meter',
      detail: `Logged ${formatNumber(day.usage)} kWh, meter moved ${formatNumber(used)} kWh`
    }
  }
  if (day.future) {
    return {
      date: day.date,
      tone: 'medium',
      title: 'Future-dated entry',
      detail: `${formatNumber(used)} kWh, recorded for a date after today`
    }
  }
  return {
    date: day.date,
    tone: 'normal',
    title: beforeIncident ? 'Last normal day' : 'Back to normal',
    detail: `${formatNumber(used)} kWh used, reading ${formatNumber(day.reading)}`
  }
}

function buildTimeline(
  days: readonly DayRecord[],
  anchor: number,
  firstIncident: number,
  baseline: number
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let quiet: DayRecord[] = []

  function flushQuiet() {
    if (quiet.length === 1) {
      events.push(describe(quiet[0], baseline, false))
    } else if (quiet.length > 1) {
      const average = sum(quiet.map((day) => day.delta ?? day.usage)) / quiet.length
      events.push({
        date: quiet[0].date,
        endDate: quiet[quiet.length - 1].date,
        tone: 'normal',
        title: 'Back to normal',
        detail: `${quiet.length} days averaging ${formatNumber(average)} kWh a day`
      })
    }
    quiet = []
  }

  days.slice(anchor).forEach((day, offset) => {
    const index = anchor + offset
    if (index > firstIncident && !isFlagged(day)) {
      quiet.push(day)
      return
    }
    flushQuiet()
    events.push(describe(day, baseline, index < firstIncident))
  })
  flushQuiet()

  return events
}

function buildChecks(days: readonly DayRecord[]): Check[] {
  const metered = days.filter((day) => day.delta !== null)
  const matched = metered.filter((day) => !day.mismatch).length
  const future = days.filter((day) => day.future).length
  const consecutive = days.every(
    (day, index) =>
      index === 0 || (Date.parse(day.date) - Date.parse(days[index - 1].date)) / MS_PER_DAY === 1
  )
  const rollback = metered.some((day) => (day.delta ?? 0) < 0)

  return [
    { passed: consecutive, label: consecutive ? 'Dates are consecutive' : 'Dates have gaps' },
    { passed: !rollback, label: rollback ? 'Meter ran backwards' : 'Readings only increase' },
    {
      passed: matched === metered.length,
      label: `Log matches meter on ${matched} of ${metered.length} days`
    },
    {
      passed: future === 0,
      label:
        future === 0
          ? 'No future-dated entries'
          : `${future} future-dated ${future === 1 ? 'entry' : 'entries'}`
    }
  ]
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function analyseLog(today: string, entries: readonly MeterEntry[] = METER_LOG): Analysis {
  const baseline = median(entries.map((entry) => entry.usage))

  const days: DayRecord[] = entries.map((entry, index) => {
    const delta = index === 0 ? null : round1(entry.reading - entries[index - 1].reading)
    return {
      ...entry,
      delta,
      spike: delta !== null && delta > baseline * SPIKE_FACTOR,
      mismatch: delta !== null && Math.abs(entry.usage - delta) > MISMATCH_TOLERANCE_KWH,
      future: entry.date > today
    }
  })

  const metered = days.filter((day) => day.delta !== null)
  const peak = days.reduce((top, day) => ((day.delta ?? 0) > (top.delta ?? 0) ? day : top))
  const firstIncident = days.findIndex(isIncident)
  const anchor = Math.max(0, firstIncident - 1)
  const projected = days.map((_, index) =>
    index < anchor ? null : round1(days[anchor].reading + (index - anchor) * baseline)
  )
  const last = days.length - 1

  return {
    days,
    baseline,
    peak,
    peakFactor: (peak.delta ?? 0) / baseline,
    peakLoadKw: (peak.delta ?? 0) / HOURS_PER_DAY,
    baselineLoadKw: baseline / HOURS_PER_DAY,
    excessKwh: sum(days.filter((day) => day.spike).map((day) => (day.delta ?? 0) - baseline)),
    ledgerGapKwh: sum(days.filter((day) => day.mismatch).map((day) => day.usage - (day.delta ?? 0))),
    meteredKwh: sum(metered.map((day) => day.delta ?? 0)),
    loggedKwh: sum(metered.map((day) => day.usage)),
    projected,
    projectionGapKwh: days[last].reading - (projected[last] ?? days[last].reading),
    counts: {
      critical: days.filter((day) => day.spike).length,
      high: days.filter((day) => day.mismatch && !day.spike).length,
      medium: days.filter((day) => day.future && !isIncident(day)).length
    },
    timeline: firstIncident < 0 ? [] : buildTimeline(days, anchor, firstIncident, baseline),
    checks: buildChecks(days)
  }
}
