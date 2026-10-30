// Reader for the field unit's live readings file (pi-stream.csv): one row per second with the sensors
// the board reported, typically t_s, CPU, V and I_A. The field unit writes "nan" for a value the board
// could not read, and says plainly that this means "not measured", never zero. This keeps that
// distinction: a column that is nan throughout is reported as unmeasured, not as a flat line at zero.

import type { EvidenceFacts, Finding } from './evidence'
import { RAIL_MAX_V, RAIL_MIN_V, THROTTLE_TEMP_C } from './januslog'

export interface ColumnStats {
  name: string
  samples: number
  missing: number
  min: number | null
  max: number | null
  mean: number | null
}

export interface ReadingsAnalysis {
  rows: number
  seconds: number | null
  columns: ColumnStats[]
  summary: string[]
  findings: Finding[]
  facts: EvidenceFacts
}

export function looksLikeReadings(text: string): boolean {
  const first = text.slice(0, 300).split(/\r?\n/, 1)[0]
  const cols = first.split(',').map((c) => c.trim().toLowerCase())
  return cols.length >= 2 && cols[0] === 't_s' && cols.every((c) => /^[a-z_][a-z0-9_]*$/.test(c))
}

const round = (n: number, places: number): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

export function analyseReadings(text: string): ReadingsAnalysis | null {
  if (!looksLikeReadings(text)) return null
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const names = lines[0].split(',').map((c) => c.trim())
  const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()))
  const columns: ColumnStats[] = names.slice(1).map((name, k) => {
    const values: number[] = []
    let missing = 0
    for (const row of rows) {
      const raw = row[k + 1]
      const v = raw === undefined || raw === '' || raw.toLowerCase() === 'nan' ? NaN : Number(raw)
      if (Number.isFinite(v)) values.push(v)
      else missing++
    }
    return {
      name,
      samples: values.length,
      missing,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    }
  })

  const findings: Finding[] = []
  const facts: EvidenceFacts = {}
  const summary: string[] = []
  const t = rows.map((r) => Number(r[0])).filter(Number.isFinite)
  const seconds = t.length > 1 ? round(t[t.length - 1] - t[0], 1) : null
  summary.push(`${rows.length} readings${seconds !== null ? ` over ${seconds} s` : ''}`)

  const unmeasured: string[] = []
  for (const c of columns) {
    if (c.samples === 0) {
      unmeasured.push(c.name)
      summary.push(`${c.name}: not measured (nan in all ${c.missing} samples), this is not zero`)
    } else {
      summary.push(`${c.name}: ${round(c.min as number, 3)} – ${round(c.max as number, 3)}${c.missing ? ` (${c.missing} missing)` : ''}`)
      if (c.missing > 0) {
        findings.push({
          severity: 'low',
          title: `${c.name} was missing in ${c.missing} of ${c.samples + c.missing} samples`,
          detail: 'Missing values are gaps in the record, not zeros.'
        })
      }
    }
  }
  if (unmeasured.length > 0) {
    facts.unmeasured = unmeasured
    findings.push({
      severity: 'high',
      title: `${unmeasured.join(', ')} was never measured`,
      detail: `The board reported no value for ${unmeasured.join(', ')} in any sample. It was not read, so it cannot be treated as zero or as normal.`
    })
  }

  const volts = columns.find((c) => /^v$|volt/i.test(c.name) && c.samples > 0)
  if (volts && volts.min !== null && volts.max !== null) {
    if (volts.min < RAIL_MIN_V || volts.max > RAIL_MAX_V) {
      findings.push({
        severity: 'high',
        title: 'The rail left its tolerance band',
        detail: `${volts.name} ran ${round(volts.min, 3)}–${round(volts.max, 3)} V against ${RAIL_MIN_V}–${RAIL_MAX_V} V (5 V ± 5 %).`
      })
    } else {
      findings.push({
        severity: 'low',
        title: 'Rail inside tolerance',
        detail: `${volts.name} ran ${round(volts.min, 3)}–${round(volts.max, 3)} V, inside ${RAIL_MIN_V}–${RAIL_MAX_V} V.`
      })
    }
  }
  const cpu = columns.find((c) => /^cpu/i.test(c.name) && c.samples > 0)
  if (cpu && cpu.max !== null && cpu.max >= THROTTLE_TEMP_C) {
    findings.push({
      severity: 'high',
      title: 'CPU reached throttling temperature',
      detail: `${cpu.name} peaked at ${round(cpu.max, 1)} °C (throttling begins near ${THROTTLE_TEMP_C} °C).`
    })
  }
  return { rows: rows.length, seconds, columns, summary, findings, facts }
}
