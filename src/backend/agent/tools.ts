import { randomUUID } from 'node:crypto'
import type { Attachment, ChartMetric, ChartSpec } from '../../shared/ai'
import { formatNumber, formatShortDate } from '../../shared/format'
import {
  HOURS_PER_DAY,
  SPIKE_FACTOR,
  isFlagged,
  median,
  round1,
  type Analysis,
  type DayRecord
} from '../../shared/meter'
import type { ToolSpec } from '../ai/provider'
import { buildMemoHtml, buildReportHtml, type ReportInput, type Severity } from '../reports/reportHtml'
import { calculate } from './calculate'
import { analyzeACH, assessInvestigation, DEFAULT_HYPOTHESES, strongestLever } from '../../shared/evidence'
import { loadStore, VaultLockedError } from '../../main/investigations/store'
import { evidenceForAi } from '../../shared/sharecopy'
import type { NoteStore } from './notes'

export interface SavedFile {
  name: string
  path: string
  bytes: number
}

export interface FileSink {
  savePdf(title: string, html: string): Promise<SavedFile>
  saveText(title: string, extension: string, text: string): Promise<SavedFile>
}

export interface ToolContext {
  analysis: Analysis
  files: FileSink
  notes: NoteStore
}

export interface ToolResult {
  output: Record<string, unknown>
  summary: string
  attachment?: Attachment
}

interface AgentTool {
  spec: ToolSpec
  label: (args: Args) => string
  run: (args: Args, context: ToolContext) => Promise<ToolResult> | ToolResult
}

type Args = Record<string, unknown>

export class ToolInputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_CO2_KG_PER_KWH = 0.71
const MAX_TEXT = 2_000
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low']
const METRICS: readonly ChartMetric[] = ['usage', 'meter_change', 'reading', 'load_kw']

function optionalDate(args: Args, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new ToolInputError(`${key} must be a date written YYYY-MM-DD`)
  }
  return value
}

function optionalNumber(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ToolInputError(`${key} must be a number from ${min} to ${max}`)
  }
  return value
}

function text(args: Args, key: string, required = true): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    if (!required) return ''
    throw new ToolInputError(`${key} is required`)
  }
  return value.trim().slice(0, MAX_TEXT)
}

function used(day: DayRecord): number {
  return day.delta ?? day.usage
}

function select(analysis: Analysis, args: Args, prefix = ''): DayRecord[] {
  const from = optionalDate(args, `${prefix}from`)
  const to = optionalDate(args, `${prefix}to`)
  const days = analysis.days.filter(
    (day) => (!from || day.date >= from) && (!to || day.date <= to)
  )
  if (days.length === 0) {
    const first = analysis.days[0].date
    const last = analysis.days[analysis.days.length - 1].date
    throw new ToolInputError(`No records in that range. The log covers ${first} to ${last}.`)
  }
  return days
}

function rangeLabel(args: Args, prefix = ''): string {
  const from = optionalDate(args, `${prefix}from`)
  const to = optionalDate(args, `${prefix}to`)
  if (!from && !to) return 'all days'
  if (from && to) return from === to ? formatShortDate(from) : `${formatShortDate(from)} – ${formatShortDate(to)}`
  return from ? `from ${formatShortDate(from)}` : `to ${formatShortDate(to as string)}`
}

function statusOf(day: DayRecord): string[] {
  const status: string[] = []
  if (day.spike) status.push('spike')
  if (day.mismatch) status.push('log does not match meter')
  if (day.future) status.push('future-dated')
  if (day.delta !== null && day.delta < 0) status.push('meter ran backwards')
  if (day.delta === null) status.push('first entry')
  return status.length ? status : ['normal']
}

function record(day: DayRecord) {
  return {
    date: day.date,
    meter_reading_kwh: day.reading,
    logged_usage_kwh: day.usage,
    meter_change_kwh: day.delta,
    status: statusOf(day)
  }
}

function stats(days: readonly DayRecord[]) {
  const values = days.map(used)
  const total = values.reduce((sum, value) => sum + value, 0)
  const mean = total / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const min = days.reduce((low, day) => (used(day) < used(low) ? day : low))
  const max = days.reduce((high, day) => (used(day) > used(high) ? day : high))
  return {
    days: days.length,
    from: days[0].date,
    to: days[days.length - 1].date,
    total_kwh: round1(total),
    mean_kwh_per_day: round1(mean),
    median_kwh_per_day: round1(median(values)),
    std_dev_kwh: round1(Math.sqrt(variance)),
    min: { date: min.date, kwh: used(min) },
    max: { date: max.date, kwh: used(max) },
    average_load_kw: Math.round((mean / HOURS_PER_DAY) * 100) / 100,
    logged_total_kwh: round1(days.reduce((sum, day) => sum + day.usage, 0)),
    flagged_days: days.filter(isFlagged).map((day) => day.date)
  }
}

function addDays(isoDate: string, count: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

function chartOf(analysis: Analysis, days: readonly DayRecord[], metric: ChartMetric, title: string): ChartSpec {
  const points = days.flatMap((day) => {
    const value =
      metric === 'usage'
        ? day.usage
        : metric === 'reading'
          ? day.reading
          : metric === 'meter_change'
            ? day.delta
            : Math.round((used(day) / HOURS_PER_DAY) * 100) / 100
    const tone = day.spike ? ('spike' as const) : isFlagged(day) ? ('flag' as const) : undefined
    return value === null ? [] : [{ date: day.date, value, flagged: isFlagged(day), ...(tone && { tone }) }]
  })
  const baseline =
    metric === 'reading'
      ? null
      : metric === 'load_kw'
        ? Math.round((analysis.baseline / HOURS_PER_DAY) * 100) / 100
        : analysis.baseline
  return {
    title,
    metric,
    unit: metric === 'load_kw' ? 'kW' : 'kWh',
    kind: metric === 'reading' ? 'line' : 'bar',
    points,
    baseline
  }
}

const RANGE_PROPERTIES = {
  from: { type: 'string', description: 'First day to include, YYYY-MM-DD. Omit to start at the beginning of the log.' },
  to: { type: 'string', description: 'Last day to include, YYYY-MM-DD. Omit to run to the end of the log.' }
}

const TOOLS: AgentTool[] = [
  {
    spec: {
      name: 'investigate_log',
      description:
        'Run the standard investigation in one call: anomaly scan, integrity audit, statistics for the whole log, and the cost of the abnormal consumption. Start here for any broad request or before writing a report.',
      parameters: {
        type: 'object',
        properties: {
          tariff_per_kwh: { type: 'number', description: 'Price of one kWh if the analyst gave one. Default 8 (INR).' },
          currency: { type: 'string', description: 'Currency code. Default INR.' }
        }
      }
    },
    label: () => 'Running full investigation',
    run: async (args, context) => {
      const tariff = optionalNumber(args, 'tariff_per_kwh', 0, 1_000) ?? 8
      const currency = text(args, 'currency', false) || 'INR'
      const [anomalies, integrity, statistics, impact] = await Promise.all([
        runTool('detect_anomalies', {}, context),
        runTool('check_integrity', {}, context),
        runTool('summarize_period', {}, context),
        runTool('estimate_impact', { tariff_per_kwh: tariff, currency }, context)
      ])
      return {
        output: {
          anomalies: anomalies.output,
          integrity: integrity.output,
          statistics: statistics.output,
          impact: impact.output
        },
        summary: [anomalies.summary, integrity.summary, impact.summary].join(' · ')
      }
    }
  },
  {
    spec: {
      name: 'get_records',
      description:
        'Read daily meter records: the cumulative meter reading, the usage written in the log, the change in the meter since the previous day, and status flags.',
      parameters: {
        type: 'object',
        properties: {
          ...RANGE_PROPERTIES,
          only_flagged: { type: 'boolean', description: 'Return only days with a spike, mismatch or other flag.' }
        }
      }
    },
    label: (args) => `Reading records · ${args['only_flagged'] ? 'flagged days' : rangeLabel(args)}`,
    run: (args, { analysis }) => {
      let days = select(analysis, args)
      if (args['only_flagged'] === true) days = days.filter(isFlagged)
      return {
        output: { count: days.length, records: days.map(record) },
        summary: `${days.length} ${days.length === 1 ? 'record' : 'records'}`
      }
    }
  },
  {
    spec: {
      name: 'summarize_period',
      description:
        'Statistics for a date range: total, mean, median, spread, lowest and highest day, and average load. Uses the meter change per day.',
      parameters: { type: 'object', properties: RANGE_PROPERTIES }
    },
    label: (args) => `Computing statistics · ${rangeLabel(args)}`,
    run: (args, { analysis }) => {
      const result = stats(select(analysis, args))
      return {
        output: result,
        summary: `${formatNumber(result.total_kwh)} kWh over ${result.days} days, ${formatNumber(result.mean_kwh_per_day)} a day`
      }
    }
  },
  {
    spec: {
      name: 'detect_anomalies',
      description:
        'Scan every day for anomalies: consumption spikes against the baseline, statistically unusual days (robust z-score), log entries that disagree with the meter, readings that go backwards, and future-dated entries. Returns each anomaly with its severity and evidence.',
      parameters: {
        type: 'object',
        properties: {
          spike_multiplier: {
            type: 'number',
            description: `A day counts as a spike above this many times the baseline. Default ${SPIKE_FACTOR}.`
          }
        }
      }
    },
    label: () => 'Scanning for anomalies',
    run: (args, { analysis }) => {
      const multiplier = optionalNumber(args, 'spike_multiplier', 1.5, 100) ?? SPIKE_FACTOR
      const { baseline } = analysis
      const changes = analysis.days.flatMap((day) => (day.delta === null ? [] : [day.delta]))
      const centre = median(changes)
      const spread = median(changes.map((value) => Math.abs(value - centre))) || 1

      const anomalies = analysis.days.flatMap((day) => {
        const found: Record<string, unknown>[] = []
        const change = day.delta
        const z = change === null ? null : Math.round(((0.6745 * (change - centre)) / spread) * 10) / 10
        if (change !== null && change < 0) {
          found.push({ date: day.date, type: 'meter_rollback', severity: 'critical', meter_change_kwh: change, detail: 'The meter reading went down, which a working meter cannot do.' })
        } else if (change !== null && change > baseline * multiplier) {
          found.push({ date: day.date, type: 'spike', severity: 'critical', meter_change_kwh: change, baseline_kwh: baseline, times_baseline: round1(change / baseline), robust_z: z })
        } else if (z !== null && z > 3.5) {
          found.push({ date: day.date, type: 'unusually_high', severity: 'medium', meter_change_kwh: change, baseline_kwh: baseline, robust_z: z })
        }
        if (day.mismatch) {
          found.push({ date: day.date, type: 'log_mismatch', severity: 'high', logged_kwh: day.usage, meter_change_kwh: change, gap_kwh: round1(day.usage - (change ?? 0)) })
        }
        if (day.future) {
          found.push({ date: day.date, type: 'future_dated', severity: 'medium', detail: 'Entry is dated after the analysis date.' })
        }
        return found
      })
      return {
        output: { baseline_kwh_per_day: baseline, spike_multiplier: multiplier, anomaly_count: anomalies.length, anomalies },
        summary: anomalies.length
          ? `${anomalies.length} found on ${new Set(anomalies.map((item) => item['date'])).size} days`
          : 'None found'
      }
    }
  },
  {
    spec: {
      name: 'check_integrity',
      description:
        'Audit the log itself: date continuity and gaps, duplicate dates, readings that only increase, log entries agreeing with the meter, and future-dated entries.',
      parameters: { type: 'object', properties: {} }
    },
    label: () => 'Auditing log integrity',
    run: (_args, { analysis }) => {
      const { days } = analysis
      const dates = days.map((day) => day.date)
      const duplicates = dates.filter((date, index) => dates.indexOf(date) !== index)
      const gaps = days.flatMap((day, index) =>
        index > 0 && addDays(days[index - 1].date, 1) !== day.date
          ? [{ after: days[index - 1].date, before: day.date }]
          : []
      )
      const rollbacks = days.filter((day) => day.delta !== null && day.delta < 0).map((day) => day.date)
      const mismatches = days.filter((day) => day.mismatch).map((day) => ({
        date: day.date,
        logged_kwh: day.usage,
        meter_change_kwh: day.delta
      }))
      const future = days.filter((day) => day.future).map((day) => day.date)
      const checks = [
        { check: 'Dates are consecutive', passed: gaps.length === 0, evidence: gaps },
        { check: 'No duplicate dates', passed: duplicates.length === 0, evidence: duplicates },
        { check: 'Readings only increase', passed: rollbacks.length === 0, evidence: rollbacks },
        { check: 'Log agrees with meter', passed: mismatches.length === 0, evidence: mismatches },
        { check: 'No future-dated entries', passed: future.length === 0, evidence: future }
      ]
      const failed = checks.filter((check) => !check.passed).length
      return {
        output: { checks_run: checks.length, failed, checks },
        summary: failed ? `${checks.length - failed} of ${checks.length} checks passed` : `All ${checks.length} checks passed`
      }
    }
  },
  {
    spec: {
      name: 'compare_periods',
      description: 'Compare two date ranges side by side, for example the week before an incident against the week after.',
      parameters: {
        type: 'object',
        properties: {
          a_from: { type: 'string', description: 'Start of the first range, YYYY-MM-DD.' },
          a_to: { type: 'string', description: 'End of the first range, YYYY-MM-DD.' },
          b_from: { type: 'string', description: 'Start of the second range, YYYY-MM-DD.' },
          b_to: { type: 'string', description: 'End of the second range, YYYY-MM-DD.' }
        },
        required: ['a_from', 'a_to', 'b_from', 'b_to']
      }
    },
    label: (args) => `Comparing ${rangeLabel(args, 'a_')} with ${rangeLabel(args, 'b_')}`,
    run: (args, { analysis }) => {
      const a = stats(select(analysis, args, 'a_'))
      const b = stats(select(analysis, args, 'b_'))
      const change = (from: number, to: number) => (from === 0 ? null : round1(((to - from) / from) * 100))
      return {
        output: {
          first: a,
          second: b,
          change_in_mean_percent: change(a.mean_kwh_per_day, b.mean_kwh_per_day),
          change_in_total_percent: change(a.total_kwh, b.total_kwh)
        },
        summary: `${formatNumber(a.mean_kwh_per_day)} → ${formatNumber(b.mean_kwh_per_day)} kWh a day`
      }
    }
  },
  {
    spec: {
      name: 'estimate_impact',
      description:
        'Estimate the cost and emissions of the abnormal consumption: energy above baseline on spike days, and the gap between logged and metered usage.',
      parameters: {
        type: 'object',
        properties: {
          tariff_per_kwh: { type: 'number', description: 'Price of one kWh. If the analyst has not given one, use 8 (INR) and say it is an assumption.' },
          currency: { type: 'string', description: 'Currency code, for example INR. Default INR.' },
          co2_kg_per_kwh: { type: 'number', description: `Grid emission factor. Default ${DEFAULT_CO2_KG_PER_KWH} (India grid average).` }
        },
        required: ['tariff_per_kwh']
      }
    },
    label: () => 'Estimating cost and emissions',
    run: (args, { analysis }) => {
      const tariff = optionalNumber(args, 'tariff_per_kwh', 0, 1_000)
      if (tariff === undefined) throw new ToolInputError('tariff_per_kwh is required')
      const currency = text(args, 'currency', false).toUpperCase().slice(0, 6) || 'INR'
      const factor = optionalNumber(args, 'co2_kg_per_kwh', 0, 5) ?? DEFAULT_CO2_KG_PER_KWH
      const excess = analysis.excessKwh
      const gap = analysis.ledgerGapKwh
      return {
        output: {
          excess_kwh_above_baseline: round1(excess),
          excess_cost: Math.round(excess * tariff),
          logged_minus_metered_kwh: round1(gap),
          logged_minus_metered_cost: Math.round(gap * tariff),
          excess_co2_kg: Math.round(excess * factor),
          currency,
          assumptions: { tariff_per_kwh: tariff, co2_kg_per_kwh: factor, baseline_kwh_per_day: analysis.baseline }
        },
        summary: `${currency} ${formatNumber(Math.round(excess * tariff), 0)} for ${formatNumber(excess, 0)} kWh above baseline`
      }
    }
  },
  {
    spec: {
      name: 'project_readings',
      description:
        'What the meter would read if consumption had stayed at the baseline from the last normal day, compared with the actual reading, plus a forecast of the next days at the baseline.',
      parameters: {
        type: 'object',
        properties: { days_ahead: { type: 'number', description: 'Days to forecast, 1 to 30. Default 7.' } }
      }
    },
    label: () => 'Projecting readings at baseline',
    run: (args, { analysis }) => {
      const ahead = Math.round(optionalNumber(args, 'days_ahead', 1, 30) ?? 7)
      const last = analysis.days[analysis.days.length - 1]
      const expected = analysis.projected[analysis.projected.length - 1] ?? last.reading
      return {
        output: {
          baseline_kwh_per_day: analysis.baseline,
          actual_last_reading: { date: last.date, kwh: last.reading },
          expected_last_reading_at_baseline: expected,
          excess_on_meter_kwh: round1(analysis.projectionGapKwh),
          forecast: Array.from({ length: ahead }, (_, index) => ({
            date: addDays(last.date, index + 1),
            expected_reading_kwh: round1(last.reading + analysis.baseline * (index + 1))
          }))
        },
        summary: `Meter ${formatNumber(analysis.projectionGapKwh)} kWh above where baseline puts it`
      }
    }
  },
  {
    spec: {
      name: 'render_chart',
      description:
        'Show the analyst a chart in the chat, drawn from the real records. Flagged days are highlighted and the baseline is marked.',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: METRICS,
            description: 'usage = logged kWh per day, meter_change = meter movement per day, reading = cumulative meter reading, load_kw = average load.'
          },
          title: { type: 'string', description: 'Short chart title.' },
          ...RANGE_PROPERTIES
        },
        required: ['metric', 'title']
      }
    },
    label: (args) => `Drawing chart · ${typeof args['title'] === 'string' ? args['title'] : 'records'}`,
    run: (args, { analysis }) => {
      const metric = args['metric'] as ChartMetric
      if (!METRICS.includes(metric)) throw new ToolInputError(`metric must be one of ${METRICS.join(', ')}`)
      const chart = chartOf(analysis, select(analysis, args), metric, text(args, 'title').slice(0, 80))
      return {
        output: { shown_to_analyst: true, title: chart.title, points: chart.points.length },
        summary: `${chart.points.length} points`,
        attachment: { kind: 'chart', id: randomUUID(), chart }
      }
    }
  },
  {
    spec: {
      name: 'generate_pdf_report',
      description:
        'Write a formal investigation report as a PDF. The app adds the case header, key figures, a consumption chart, integrity checks and, optionally, the full records table. You supply the narrative. Gather the evidence with the other tools first, and write every number from their results. Write like a professional investigator: plain, factual sentences, no Markdown, no em dashes, no emphatic or promotional words, no rhetorical openers.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Report title.' },
          executive_summary: { type: 'string', description: 'Two to four plain sentences: what happened, when, how large, and what it means. State facts; avoid words like significant, alarming or critical.' },
          findings: {
            type: 'array',
            description: 'The findings, most severe first.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                severity: { type: 'string', enum: SEVERITIES },
                detail: { type: 'string', description: 'Evidence with dates and values.' }
              },
              required: ['title', 'severity', 'detail']
            }
          },
          recommendations: { type: 'array', items: { type: 'string' }, description: 'Concrete next steps for the investigator.' },
          include_records: { type: 'boolean', description: 'Append the full daily records table. Default true.' }
        },
        required: ['title', 'executive_summary', 'findings', 'recommendations']
      }
    },
    label: () => 'Writing PDF report',
    run: async (args, { analysis, files }) => {
      const findings = Array.isArray(args['findings']) ? args['findings'].slice(0, 12) : []
      const input: ReportInput = {
        title: text(args, 'title').slice(0, 120),
        summary: text(args, 'executive_summary'),
        findings: findings.map((item, index) => {
          const finding = (typeof item === 'object' && item !== null ? item : {}) as Args
          const severity = finding['severity'] as Severity
          return {
            title: text(finding, 'title', false).slice(0, 160) || `Finding ${index + 1}`,
            severity: SEVERITIES.includes(severity) ? severity : 'medium',
            detail: text(finding, 'detail', false)
          }
        }),
        recommendations: (Array.isArray(args['recommendations']) ? args['recommendations'] : [])
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .slice(0, 10)
          .map((item) => item.trim().slice(0, 600)),
        includeRecords: args['include_records'] !== false
      }
      if (input.findings.length === 0) throw new ToolInputError('findings needs at least one entry')

      const file = await files.savePdf(input.title, buildReportHtml(input, analysis, new Date()))
      return {
        output: { saved: true, file: file.name, findings: input.findings.length },
        summary: file.name,
        attachment: {
          kind: 'file',
          id: randomUUID(),
          format: 'pdf',
          name: file.name,
          path: file.path,
          bytes: file.bytes,
          description: `Investigation report · ${input.findings.length} ${input.findings.length === 1 ? 'finding' : 'findings'}`
        }
      }
    }
  },
  {
    spec: {
      name: 'export_csv',
      description: 'Save daily records as a CSV spreadsheet for the analyst.',
      parameters: {
        type: 'object',
        properties: {
          ...RANGE_PROPERTIES,
          only_flagged: { type: 'boolean', description: 'Export only flagged days.' }
        }
      }
    },
    label: (args) => `Exporting CSV · ${args['only_flagged'] ? 'flagged days' : rangeLabel(args)}`,
    run: async (args, { analysis, files }) => {
      let days = select(analysis, args)
      if (args['only_flagged'] === true) days = days.filter(isFlagged)
      if (days.length === 0) throw new ToolInputError('No flagged days to export.')
      const rows = [
        'date,meter_reading_kwh,logged_usage_kwh,meter_change_kwh,status',
        ...days.map((day) =>
          [day.date, day.reading, day.usage, day.delta ?? '', `"${statusOf(day).join('; ')}"`].join(',')
        )
      ]
      const title = args['only_flagged'] === true ? 'flagged-days' : 'meter-records'
      const file = await files.saveText(title, 'csv', `${rows.join('\r\n')}\r\n`)
      return {
        output: { saved: true, file: file.name, rows: days.length },
        summary: `${days.length} rows · ${file.name}`,
        attachment: {
          kind: 'file',
          id: randomUUID(),
          format: 'csv',
          name: file.name,
          path: file.path,
          bytes: file.bytes,
          description: `${days.length} daily ${days.length === 1 ? 'record' : 'records'}`
        }
      }
    }
  },
  {
    spec: {
      name: 'inspect_day',
      description: 'Deep look at one day: its record, how it ranks, its ratio to baseline, the days either side, and the implied average load.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
        required: ['date']
      }
    },
    label: (args) => `Inspecting day · ${typeof args['date'] === 'string' ? formatShortDate(args['date']) : 'day'}`,
    run: (args, { analysis }) => {
      const date = optionalDate(args, 'date')
      const index = analysis.days.findIndex((day) => day.date === date)
      if (!date || index < 0) throw new ToolInputError('That date is not in the log.')
      const day = analysis.days[index]
      const ranked = [...analysis.days].sort((a, b) => used(b) - used(a))
      const neighbour = (offset: number) => {
        const other = analysis.days[index + offset]
        return other ? { date: other.date, kwh: used(other) } : null
      }
      return {
        output: {
          record: record(day),
          rank_by_consumption: `${ranked.indexOf(day) + 1} of ${ranked.length}`,
          times_baseline: round1(used(day) / analysis.baseline),
          implied_average_load_kw: Math.round((used(day) / HOURS_PER_DAY) * 100) / 100,
          previous_day: neighbour(-1),
          next_day: neighbour(1)
        },
        summary: `${formatNumber(used(day))} kWh · ${round1(used(day) / analysis.baseline)}× baseline · rank ${ranked.indexOf(day) + 1}`
      }
    }
  },
  {
    spec: {
      name: 'rank_days',
      description: 'Rank days by meter change, logged usage, or the gap between log and meter.',
      parameters: {
        type: 'object',
        properties: {
          by: { type: 'string', enum: ['meter_change', 'usage', 'gap'] },
          order: { type: 'string', enum: ['highest', 'lowest'], description: 'Default highest.' },
          limit: { type: 'number', description: '1 to 20. Default 5.' }
        },
        required: ['by']
      }
    },
    label: (args) => `Ranking days · ${String(args['order'] ?? 'highest')} ${String(args['by'] ?? '').replace('_', ' ')}`,
    run: (args, { analysis }) => {
      const by = args['by']
      if (by !== 'meter_change' && by !== 'usage' && by !== 'gap') {
        throw new ToolInputError('by must be meter_change, usage or gap')
      }
      const limit = Math.round(optionalNumber(args, 'limit', 1, 20) ?? 5)
      const valueOf = (day: DayRecord) =>
        by === 'usage' ? day.usage : by === 'gap' ? round1(day.usage - (day.delta ?? day.usage)) : used(day)
      const sorted = [...analysis.days].sort((a, b) => valueOf(b) - valueOf(a))
      const picked = (args['order'] === 'lowest' ? sorted.reverse() : sorted).slice(0, limit)
      return {
        output: { by, ranking: picked.map((day, place) => ({ place: place + 1, date: day.date, value_kwh: valueOf(day), status: statusOf(day) })) },
        summary: picked.map((day) => formatShortDate(day.date)).join(', ')
      }
    }
  },
  {
    spec: {
      name: 'reconcile_ledger',
      description: 'Reconcile the written log against the meter day by day, with the running total of the difference.',
      parameters: { type: 'object', properties: {} }
    },
    label: () => 'Reconciling log against meter',
    run: (_args, { analysis }) => {
      let running = 0
      const rows = analysis.days.flatMap((day) => {
        if (day.delta === null) return []
        const difference = round1(day.usage - day.delta)
        running = round1(running + difference)
        return [{ date: day.date, logged_kwh: day.usage, metered_kwh: day.delta, difference_kwh: difference, running_difference_kwh: running, matches: !day.mismatch }]
      })
      const unmatched = rows.filter((row) => !row.matches).length
      return {
        output: {
          logged_total_kwh: round1(analysis.loggedKwh),
          metered_total_kwh: round1(analysis.meteredKwh),
          net_difference_kwh: round1(analysis.ledgerGapKwh),
          days_not_matching: unmatched,
          rows
        },
        summary: `${unmatched} of ${rows.length} days differ · net ${formatNumber(analysis.ledgerGapKwh)} kWh`
      }
    }
  },
  {
    spec: {
      name: 'simulate_scenario',
      description: 'What-if: treat the given days as normal (baseline consumption) and show how totals and cost would change.',
      parameters: {
        type: 'object',
        properties: {
          normalize_dates: { type: 'array', items: { type: 'string' }, description: 'Days to set to baseline, YYYY-MM-DD.' },
          tariff_per_kwh: { type: 'number', description: 'Default 8 (INR).' }
        },
        required: ['normalize_dates']
      }
    },
    label: (args) => `Simulating scenario · ${Array.isArray(args['normalize_dates']) ? args['normalize_dates'].length : 0} days normalised`,
    run: (args, { analysis }) => {
      const dates = Array.isArray(args['normalize_dates']) ? args['normalize_dates'].filter((item): item is string => typeof item === 'string') : []
      const known = new Set(analysis.days.map((day) => day.date))
      const missing = dates.filter((date) => !known.has(date))
      if (dates.length === 0 || missing.length) throw new ToolInputError(missing.length ? `Not in the log: ${missing.join(', ')}` : 'normalize_dates is required')
      const tariff = optionalNumber(args, 'tariff_per_kwh', 0, 1_000) ?? 8
      const actual = analysis.days.reduce((sum, day) => sum + used(day), 0)
      const simulated = analysis.days.reduce((sum, day) => sum + (dates.includes(day.date) ? analysis.baseline : used(day)), 0)
      const removed = round1(actual - simulated)
      return {
        output: {
          normalized_days: dates,
          actual_total_kwh: round1(actual),
          scenario_total_kwh: round1(simulated),
          energy_removed_kwh: removed,
          cost_difference: Math.round(removed * tariff),
          tariff_per_kwh: tariff,
          actual_mean_kwh_per_day: round1(actual / analysis.days.length),
          scenario_mean_kwh_per_day: round1(simulated / analysis.days.length)
        },
        summary: `${formatNumber(removed)} kWh less · ${formatNumber(Math.round(removed * tariff), 0)} saved`
      }
    }
  },
  {
    spec: {
      name: 'calculate',
      description: 'Evaluate arithmetic exactly. Use it for any sum, ratio or percentage instead of working it out yourself.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'For example (2684 - 27.85) * 8. Operators: + - * / % ^ and parentheses.' } },
        required: ['expression']
      }
    },
    label: (args) => `Calculating · ${String(args['expression'] ?? '').slice(0, 40)}`,
    run: (args) => {
      const expression = text(args, 'expression')
      let result: number
      try {
        result = calculate(expression)
      } catch (cause) {
        throw new ToolInputError(cause instanceof Error ? cause.message : 'Invalid expression.')
      }
      const rounded = Math.round(result * 1e6) / 1e6
      return { output: { expression, result: rounded }, summary: `= ${formatNumber(rounded, Number.isInteger(rounded) ? 0 : 2)}` }
    }
  },
  {
    spec: {
      name: 'create_memo',
      description: 'Write a one-page memo or notice as a PDF, for example to a facilities manager or the utility. Plain, formal prose; no Markdown.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          from: { type: 'string', description: 'Default: Janus investigation team.' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'The memo text. Separate paragraphs with a blank line.' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    label: (args) => `Writing memo · ${String(args['subject'] ?? '').slice(0, 50)}`,
    run: async (args, { files }) => {
      const memo = {
        to: text(args, 'to').slice(0, 160),
        from: text(args, 'from', false).slice(0, 160) || 'Janus investigation team',
        subject: text(args, 'subject').slice(0, 160),
        body: text(args, 'body')
      }
      const file = await files.savePdf(`memo-${memo.subject}`, buildMemoHtml(memo, new Date()))
      return {
        output: { saved: true, file: file.name },
        summary: file.name,
        attachment: { kind: 'file', id: randomUUID(), format: 'pdf', name: file.name, path: file.path, bytes: file.bytes, description: `Memo to ${memo.to}` }
      }
    }
  },
  {
    spec: {
      name: 'case_notes',
      description: 'The case notebook, kept across conversations. add saves a finding worth remembering; list returns saved notes.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list'] },
          note: { type: 'string', description: 'The note to save, for add.' }
        },
        required: ['action']
      }
    },
    label: (args) => (args['action'] === 'add' ? 'Saving case note' : 'Reading case notes'),
    run: async (args, { notes }) => {
      if (args['action'] === 'add') {
        const note = await notes.add(text(args, 'note').slice(0, 600))
        return { output: { saved: true, id: note.id }, summary: 'Saved' }
      }
      const all = await notes.list()
      return {
        output: { count: all.length, notes: all.slice(-30).map(({ text: note, createdAt }) => ({ note, saved_at: createdAt })) },
        summary: `${all.length} ${all.length === 1 ? 'note' : 'notes'}`
      }
    }
  },
  {
    spec: {
      name: 'assess_case',
      description:
        'Assess an investigation from the case file: grade each piece of evidence A-F by reliability, list the discrepancies, rank the competing hypotheses by likelihood, give the probability for the leading one with a confidence level, and name the single next step that would most raise confidence. Use this whenever the analyst asks how strong a case is, what the evidence shows, which explanation is most likely, or what to collect next. This reads the shared case file, separate from the meter log.',
      parameters: {
        type: 'object',
        properties: {
          investigation_id: {
            type: 'string',
            description: 'Which investigation to assess. Omit to use the most recent one.'
          }
        }
      }
    },
    label: () => 'Assessing the case file',
    run: async (args) => {
      let store
      try {
        store = await loadStore()
      } catch (error) {
        if (error instanceof VaultLockedError) {
          return { output: { available: false, reason: 'The case vault is locked. The analyst must unlock it in Janus first.' }, summary: 'Case vault is locked' }
        }
        throw error
      }
      const privacy = store.settings.privacy
      // Case data goes to a third-party model only if the analyst has said so. The default is that it does not.
      if (privacy.aiCaseAccess === 'off') {
        return {
          output: {
            available: false,
            reason: 'The analyst has not allowed the assistant to read case data. They can change this under Privacy in Janus (AI access to cases).'
          },
          summary: 'Case access is off (Privacy)'
        }
      }
      if (store.investigations.length === 0) {
        return { output: { investigations: 0 }, summary: 'No investigations on file' }
      }
      const wanted = typeof args['investigation_id'] === 'string' ? (args['investigation_id'] as string) : null
      const picked =
        (wanted ? store.investigations.find((item) => item.id === wanted) : undefined) ?? store.investigations[0]
      const view = evidenceForAi(
        store.evidence.filter((item) => item.investigationId === picked.id),
        picked,
        privacy,
        store.settings.agent
      )
      const investigation = view.investigation
      const evidence = view.evidence
      const today = new Date().toISOString().slice(0, 10)
      const context = { incident: investigation.incident ?? null }
      const assessment = assessInvestigation(evidence, today, context)
      const ach = analyzeACH(investigation.hypotheses ?? DEFAULT_HYPOTHESES, evidence)
      const lever = strongestLever(evidence, today, context)
      const pct = assessment.estimate === null ? null : Math.round(assessment.estimate * 100)
      return {
        output: {
          investigation: investigation.title,
          incident_window: investigation.incident ?? null,
          redacted: view.redacted,
          verdict: assessment.verdict,
          probability_percent: pct,
          confidence: assessment.confidenceLabel,
          evidence: assessment.graded.map((e) => ({
            title: e.title,
            grade: e.grade,
            reliability: e.score,
            stance: e.stance,
            sealed: e.factors.sealed,
            seal_verified_by_janus: e.verification?.state === 'verified',
            type: e.type
          })),
          discrepancies: assessment.discrepancies.map((d) => ({ severity: d.severity, title: d.title, detail: d.detail, resolves_with: d.action })),
          hypotheses: ach.hypotheses.map((h) => ({
            rank: h.rank,
            hypothesis: h.label,
            likelihood_percent: Math.round(h.likelihood * 100),
            inconsistency: h.inconsistency
          })),
          biggest_lever: lever
            ? { action: lever.action, from_confidence: lever.fromConfidence, to_confidence: lever.toConfidence }
            : null,
          next_steps: assessment.nextSteps
        },
        summary: `${ach.hypotheses[0]?.label ?? 'no hypothesis'} leads${
          pct !== null ? ` at ${pct}%` : ''
        }, ${assessment.confidenceLabel.toLowerCase()} confidence, ${assessment.graded.length} items${view.redacted ? ' (redacted)' : ''}`
      }
    }
  }
]

const BY_NAME = new Map(TOOLS.map((tool) => [tool.spec.name, tool]))

export const TOOL_SPECS: readonly ToolSpec[] = TOOLS.map((tool) => tool.spec)

export function toolLabel(name: string, args: Args): string {
  try {
    return BY_NAME.get(name)?.label(args) ?? name
  } catch {
    return name
  }
}

export async function runTool(name: string, args: Args, context: ToolContext): Promise<ToolResult> {
  const tool = BY_NAME.get(name)
  if (!tool) throw new ToolInputError(`There is no tool named ${name}.`)
  return tool.run(args, context)
}
