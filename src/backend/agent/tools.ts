import { randomUUID } from 'node:crypto'
import type { Attachment, ChartMetric, ChartSpec } from '../../shared/ai'
import { formatNumber, formatShortDate } from '../../shared/format'
import { CASE_FILE } from '../../shared/caseFile'
import { GAME_SOURCE, SOURCE_ANALYSIS } from '../../shared/gameSource'
import {
  VERDICT_LABELS,
  formatShare,
  localDate,
  type CrossCheck,
  type MachineCase,
  type MachineDay
} from '../../shared/machine'
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

export interface MachineContext extends MachineCase {
  cross: CrossCheck
}

export interface ToolContext {
  analysis: Analysis
  files: FileSink
  notes: NoteStore
  machine: MachineContext | null
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
const METRICS: readonly ChartMetric[] = ['usage', 'meter_change', 'reading', 'load_kw', 'cabinet_wh', 'cabinet_peak_c']
const MAX_HOURLY_ROWS = 72
const MAX_DAILY_ROWS = 120
const DEFAULT_CABINET_DAYS = 30
const JOURNAL_LEVELS = ['INFO', 'WARN', 'ERROR'] as const
const REPORTED_SOURCES = new Set(CASE_FILE.map((report) => report.source))

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

function requireMachine(context: ToolContext): MachineContext {
  if (!context.machine) {
    throw new ToolInputError('No cabinet logs are loaded in this session. Start a session from logs.janus first.')
  }
  return context.machine
}

function cabinetDays(machine: MachineContext, args: Args, fallbackDays: number): MachineDay[] {
  const { daily } = machine.analysis
  const from = optionalDate(args, 'from')
  const to = optionalDate(args, 'to')
  const days =
    from || to
      ? daily.filter((day) => (!from || day.date >= from) && (!to || day.date <= to))
      : daily.slice(-fallbackDays)
  if (days.length === 0) {
    throw new ToolInputError(`No cabinet telemetry in that range. It covers ${daily[0].date} to ${daily[daily.length - 1].date}.`)
  }
  return days
}

function cabinetChart(machine: MachineContext, args: Args, metric: ChartMetric, title: string): ChartSpec {
  const days = cabinetDays(machine, args, DEFAULT_CABINET_DAYS)
  if (days.length > MAX_DAILY_ROWS) throw new ToolInputError(`Charts hold up to ${MAX_DAILY_ROWS} days; narrow the range.`)
  const values = days.map((day) => (metric === 'cabinet_wh' ? day.wh : day.maxCpuC))
  return {
    title,
    metric,
    unit: metric === 'cabinet_wh' ? 'Wh' : '°C',
    kind: metric === 'cabinet_wh' && days.length <= 40 ? 'bar' : 'line',
    points: days.map((day, index) => ({ date: day.date, value: values[index], flagged: false })),
    baseline: round1(values.reduce((sum, value) => sum + value, 0) / values.length)
  }
}

function sealOutput(seal: MachineContext['seal']) {
  return {
    algorithm: seal.algorithm,
    sealed_fingerprint: seal.fingerprint,
    current_fingerprint: seal.current,
    sealed_at: seal.sealedAt,
    checked_at: seal.checkedAt,
    intact: seal.intact
  }
}

function explanationsOutput(cross: CrossCheck) {
  return {
    incident: {
      date: cross.incident.date,
      excess_kwh_above_baseline: cross.incident.excessKwh,
      extra_load_kw_over_24h: cross.incident.extraLoadKw
    },
    energy_budget: {
      cabinet_max_possible_wh_per_day: cross.budget.ceilingDailyWh,
      cabinet_mean_wh_per_day: cross.budget.meanDailyWh,
      share_of_excess_cabinet_could_draw: formatShare(cross.budget.sharePct),
      excess_equals_years_of_cabinet_use: cross.budget.yearsOfUse
    },
    telemetry_coverage: {
      last_sample: cross.coverage.lastSampleAt,
      reaches_incident_day: cross.coverage.reachesIncident,
      hours_short_of_incident_day: cross.coverage.hoursShort
    },
    explanations: cross.explanations.map((item) => ({
      claim: item.claim,
      raised_by: item.source,
      verdict: VERDICT_LABELS[item.verdict],
      evidence: item.evidence
    }))
  }
}

function explanationsSummary(cross: CrossCheck): string {
  const count = (verdict: string) => cross.explanations.filter((item) => item.verdict === verdict).length
  return `${count('ruled_out')} ruled out, ${count('unlikely')} don’t fit, ${count('open')} open`
}

function sourceOutput() {
  const analysis = SOURCE_ANALYSIS
  return {
    file: GAME_SOURCE.file,
    original: {
      origin: GAME_SOURCE.original.origin,
      lines: analysis.original.lines.length,
      classes: analysis.original.classes.map((item) => item.name)
    },
    recovered: {
      origin: GAME_SOURCE.recovered.origin,
      lines: analysis.recovered.lines.length,
      classes: analysis.recovered.classes.map((item) => item.name)
    },
    lines_removed: analysis.removedLines,
    lines_added: analysis.addedLines,
    classes_removed: analysis.removedClasses.map((item) => ({
      name: item.name,
      original_lines: `${item.startLine}-${item.endLine}`,
      members: item.members
    })),
    lines_still_using_removed_classes: analysis.dangling.map((use) => ({
      line: use.line,
      uses: use.name,
      kind: use.kind,
      code: use.text
    })),
    recovered_source_compiles: analysis.compiles
  }
}

function sourceSummary(): string {
  const names = SOURCE_ANALYSIS.removedClasses.map((item) => item.name).join(', ') || 'No class'
  return `${names} removed · ${SOURCE_ANALYSIS.dangling.length} dependent lines · ${SOURCE_ANALYSIS.compiles ? 'compiles' : 'won’t compile'}`
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
        'Run the standard investigation in one call: anomaly scan, integrity audit, statistics for the whole log, the cost of the abnormal consumption, the game source comparison and, when cabinet logs are loaded, the cabinet cross-check (energy budget, forensic checks, the Dossier explanations tested). Start here for any broad request or before writing a report.',
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
      const { machine } = context
      return {
        output: {
          anomalies: anomalies.output,
          integrity: integrity.output,
          statistics: statistics.output,
          impact: impact.output,
          game_source: sourceOutput(),
          cabinet: machine
            ? {
                ...explanationsOutput(machine.cross),
                forensic_checks: machine.cross.checks.map(({ label, passed, detail }) => ({ check: label, passed, detail })),
                evidence_seal_intact: machine.seal.intact
              }
            : 'No cabinet logs loaded'
        },
        summary: [
          anomalies.summary,
          integrity.summary,
          impact.summary,
          sourceSummary(),
          ...(machine ? [explanationsSummary(machine.cross)] : [])
        ].join(' · ')
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
            description: 'usage = logged kWh per day, meter_change = meter movement per day, reading = cumulative meter reading, load_kw = average load, cabinet_wh = the arcade cabinet’s own energy per day, cabinet_peak_c = its hottest CPU reading per day. Cabinet charts default to the last 30 days of telemetry.'
          },
          title: { type: 'string', description: 'Short chart title.' },
          ...RANGE_PROPERTIES
        },
        required: ['metric', 'title']
      }
    },
    label: (args) => `Drawing chart · ${typeof args['title'] === 'string' ? args['title'] : 'records'}`,
    run: (args, context) => {
      const metric = args['metric'] as ChartMetric
      if (!METRICS.includes(metric)) throw new ToolInputError(`metric must be one of ${METRICS.join(', ')}`)
      const title = text(args, 'title').slice(0, 80)
      const chart = metric.startsWith('cabinet_')
        ? cabinetChart(requireMachine(context), args, metric, title)
        : chartOf(context.analysis, select(context.analysis, args), metric, title)
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
        'Write a formal investigation report as a PDF. The app adds the case header, key figures, a consumption chart, integrity checks, the cabinet cross-check with the evidence seal when cabinet logs are loaded and, optionally, the full records table. You supply the narrative. Gather the evidence with the other tools first, and write every number from their results. Write like a professional investigator: plain, factual sentences, no Markdown, no em dashes, no emphatic or promotional words, no rhetorical openers.',
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
    run: async (args, { analysis, files, machine }) => {
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

      const evidence = machine ? { analysis: machine.analysis, cross: machine.cross, seal: await machine.verify() } : null
      const file = await files.savePdf(input.title, buildReportHtml(input, analysis, new Date(), evidence))
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
      description: 'Write a one-page memo or notice as a PDF, for example to the Department of Electricity, a facilities manager or a fellow agent. Plain, formal prose; no Markdown.',
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
      name: 'inspect_cabinet',
      description:
        'Overview of the arcade cabinet’s own telemetry from logs.janus: identity, coverage, power draw, supply rail, temperatures, opening hours, reboots, hardware changes, maintenance, forensic checks and the evidence seal.',
      parameters: { type: 'object', properties: {} }
    },
    label: () => 'Inspecting the arcade cabinet',
    run: (_args, context) => {
      const { analysis, cross, seal } = requireMachine(context)
      const failed = cross.checks.filter((check) => !check.passed).length
      return {
        output: {
          machine: analysis.machine,
          coverage: {
            first_sample: analysis.coverage.start,
            last_sample: analysis.coverage.end,
            hours_present: analysis.coverage.samples,
            hours_expected: analysis.coverage.expected
          },
          power: {
            mean_w: analysis.power.meanW,
            peak_w: analysis.power.peakW,
            peak_at: analysis.power.peakAt,
            mean_wh_per_day: analysis.power.meanDailyWh,
            max_possible_wh_per_day: analysis.power.ceilingDailyWh
          },
          supply_rail: {
            min_v: analysis.rail.minV,
            max_v: analysis.rail.maxV,
            within_tolerance: analysis.rail.withinTolerance,
            monitor_checks: analysis.rail.monitorChecks,
            monitor_alerts: analysis.rail.monitorAlerts
          },
          thermal: {
            mean_cpu_c: analysis.thermal.meanCpuC,
            peak_cpu_c: analysis.thermal.peakCpuC,
            peak_at: analysis.thermal.peakAt,
            fan_ramps: analysis.thermal.fanRamps,
            throttled_hours: analysis.thermal.throttledHours,
            last_reading: analysis.thermal.latest
          },
          opening_hours: `${analysis.activity.openHour}:00 to ${analysis.activity.closeHour}:00`,
          mean_players_per_day: analysis.activity.meanPlayers,
          reboots: {
            uptime_resets: analysis.boots.resets,
            boots_in_journal: analysis.boots.journaled,
            boots_without_uptime_reset: analysis.boots.silent,
            resets_missing_from_journal: analysis.boots.unjournaledResets
          },
          hardware_changes: analysis.hardwareChanges,
          maintenance: analysis.maintenance,
          forensic_checks: cross.checks.map(({ label, passed, detail }) => ({ check: label, passed, detail })),
          evidence_seal: sealOutput(seal)
        },
        summary: failed ? `${failed} of ${cross.checks.length} checks need review` : `All ${cross.checks.length} checks passed`
      }
    }
  },
  {
    spec: {
      name: 'query_telemetry',
      description: `Read the cabinet’s telemetry for a date range. daily gives energy, peak power, hottest CPU reading, cabinet air temperature, active hours and players per day (up to ${MAX_DAILY_ROWS} days). hourly gives every sample: state, power, 5 V rail, CPU and air temperature, CPU load, fan, uptime and memory (up to ${MAX_HOURLY_ROWS} hours).`,
      parameters: {
        type: 'object',
        properties: {
          ...RANGE_PROPERTIES,
          resolution: { type: 'string', enum: ['daily', 'hourly'], description: 'Default daily.' }
        }
      }
    },
    label: (args) => `Reading cabinet telemetry · ${args['resolution'] === 'hourly' ? 'hourly' : 'daily'} · ${rangeLabel(args)}`,
    run: (args, context) => {
      const machine = requireMachine(context)
      if (args['resolution'] === 'hourly') {
        const from = optionalDate(args, 'from')
        const to = optionalDate(args, 'to')
        const samples =
          from || to
            ? machine.log.hourly.filter((sample) => {
                const date = localDate(sample.at)
                return (!from || date >= from) && (!to || date <= to)
              })
            : machine.log.hourly.slice(-24)
        if (samples.length === 0) {
          const { start, end } = machine.analysis.coverage
          throw new ToolInputError(`No cabinet telemetry in that range. It covers ${localDate(start)} to ${localDate(end)}.`)
        }
        if (samples.length > MAX_HOURLY_ROWS) {
          throw new ToolInputError(`Hourly data is limited to ${MAX_HOURLY_ROWS} hours. Narrow the range or use daily.`)
        }
        return {
          output: {
            resolution: 'hourly',
            count: samples.length,
            samples: samples.map((sample) => ({
              at: sample.at,
              state: sample.active ? 'active' : 'standby',
              power_w: sample.powerW,
              rail_v: sample.railV,
              cpu_temp_c: sample.cpuTempC,
              air_temp_c: sample.airTempC,
              cpu_util_pct: sample.cpuUtilPct,
              fan_rpm: sample.fanRpm,
              uptime_h: sample.uptimeH,
              memory_mb: sample.memoryMb
            }))
          },
          summary: `${samples.length} hourly samples`
        }
      }
      const days = cabinetDays(machine, args, 14)
      if (days.length > MAX_DAILY_ROWS) {
        throw new ToolInputError(`Daily data is limited to ${MAX_DAILY_ROWS} days. Narrow the range.`)
      }
      return {
        output: {
          resolution: 'daily',
          count: days.length,
          days: days.map((day) => ({
            date: day.date,
            hours: day.hours,
            energy_wh: day.wh,
            peak_w: day.peakW,
            max_cpu_c: day.maxCpuC,
            mean_air_c: day.meanAirC,
            active_hours: day.activeHours,
            players: day.players
          }))
        },
        summary: `${days.length} ${days.length === 1 ? 'day' : 'days'} of telemetry`
      }
    }
  },
  {
    spec: {
      name: 'read_journal',
      description: 'Search the cabinet’s system journal: boots, restarts, maintenance, thermal and network messages. Filter by date range, level, service or text.',
      parameters: {
        type: 'object',
        properties: {
          ...RANGE_PROPERTIES,
          level: { type: 'string', enum: JOURNAL_LEVELS },
          service: { type: 'string', description: 'For example systemd, game-service, thermal, network, maintenance.' },
          contains: { type: 'string', description: 'Text the message must contain.' },
          limit: { type: 'number', description: '1 to 60. Default 25.' }
        }
      }
    },
    label: (args) => {
      const contains = typeof args['contains'] === 'string' ? args['contains'].trim() : ''
      return `Searching cabinet journal · ${contains ? `“${contains.slice(0, 30)}”` : rangeLabel(args)}`
    },
    run: (args, context) => {
      const machine = requireMachine(context)
      const from = optionalDate(args, 'from')
      const to = optionalDate(args, 'to')
      const level = text(args, 'level', false).toUpperCase()
      const service = text(args, 'service', false).toLowerCase()
      const contains = text(args, 'contains', false).toLowerCase()
      const limit = Math.round(optionalNumber(args, 'limit', 1, 60) ?? 25)
      const matches = machine.log.journal.filter((entry) => {
        const date = localDate(entry.at)
        return (
          (!from || date >= from) &&
          (!to || date <= to) &&
          (!level || entry.level === level) &&
          (!service || entry.service.toLowerCase().includes(service)) &&
          (!contains || entry.message.toLowerCase().includes(contains))
        )
      })
      return {
        output: {
          matches: matches.length,
          shown: Math.min(limit, matches.length),
          entries: matches.slice(0, limit).map((entry) => ({
            at: entry.at,
            service: entry.service,
            level: entry.level,
            message: entry.message
          }))
        },
        summary: `${matches.length} ${matches.length === 1 ? 'entry' : 'entries'}`
      }
    }
  },
  {
    spec: {
      name: 'test_explanations',
      description:
        'Test the explanations for the spike against the evidence: whether the cabinet could have drawn the energy, the three causes the Energy Dossier raises (HVAC startup, harmonics, phase imbalance), a meter fault, and signs the telemetry was edited. Returns a verdict and evidence for each, the energy budget, and whether the telemetry covers the incident day.',
      parameters: { type: 'object', properties: {} }
    },
    label: () => 'Testing the official explanations',
    run: (_args, context) => {
      const { cross } = requireMachine(context)
      return { output: explanationsOutput(cross), summary: explanationsSummary(cross) }
    }
  },
  {
    spec: {
      name: 'verify_evidence',
      description: 'Re-hash logs.janus now and compare it with the SHA-256 seal taken when the session was created, to show whether the evidence file has changed.',
      parameters: { type: 'object', properties: {} }
    },
    label: () => 'Verifying the evidence seal',
    run: async (_args, context) => {
      const seal = await requireMachine(context).verify()
      return {
        output: sealOutput(seal),
        summary: seal.intact ? `Seal intact · ${seal.current.slice(0, 12)}…` : 'File changed since sealing'
      }
    }
  },
  {
    spec: {
      name: 'compare_game_source',
      description:
        'Compare the original source of The Reckoning V: Origins with the copy recovered from the cabinet on Oct 24: line diff, classes declared in each, members of any removed class, every line in the recovered copy that still uses a removed class, and whether the recovered copy can compile.',
      parameters: { type: 'object', properties: {} }
    },
    label: () => 'Comparing the game source',
    run: () => ({ output: sourceOutput(), summary: sourceSummary() })
  },
  {
    spec: {
      name: 'case_timeline',
      description: 'One timeline across every source: the Energy Dossier meter log, the cabinet telemetry, and case file reports (marked unverified).',
      parameters: { type: 'object', properties: RANGE_PROPERTIES }
    },
    label: (args) => `Building case timeline · ${rangeLabel(args)}`,
    run: (args, context) => {
      const { cross } = requireMachine(context)
      const from = optionalDate(args, 'from')
      const to = optionalDate(args, 'to')
      const events = cross.timeline.filter((event) => {
        const date = localDate(event.at)
        return (!from || date >= from) && (!to || date <= to)
      })
      return {
        output: {
          count: events.length,
          events: events.map((event) => ({
            at: event.at,
            event: event.title,
            detail: event.detail,
            source: event.source,
            evidence: REPORTED_SOURCES.has(event.source) ? 'reported, unverified' : 'measured'
          }))
        },
        summary: `${events.length} events`
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
