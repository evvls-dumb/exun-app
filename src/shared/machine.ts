import { CASE_FILE } from './caseFile'
import { formatNumber, formatShortDate } from './format'
import type { HourlySample, JanusLog, JournalEntry, MaintenanceRecord } from './janus'
import { round1, type Analysis, type Tone } from './meter'

const HOUR_MS = 3_600_000
const RAIL_NOMINAL_V = 5
const RAIL_TOLERANCE = 0.05
const POWER_TOLERANCE_W = 0.05
const RECENT_HOURS = 168
const RULED_OUT_HEADROOM = 100
const DAYS_PER_YEAR = 365.25

export interface MachineDay {
  date: string
  hours: number
  wh: number
  peakW: number
  maxCpuC: number
  meanAirC: number
  activeHours: number
  players: number | null
}

export interface HourPoint {
  at: string
  powerW: number
  cpuC: number
  airC: number
  active: boolean
}

export interface MachineEvent {
  at: string
  tone: Tone
  title: string
  detail: string
  source: string
}

export interface ForensicCheck {
  id: string
  passed: boolean
  label: string
  detail: string
}

export interface SilentBoot {
  at: string
  message: string
  uptimeBefore: number
  uptimeAfter: number
  hardwareChanged: boolean
}

export interface HardwareChange {
  at: string
  fromMb: number
  toMb: number
  uptimeBefore: number
  uptimeAfter: number
}

export interface MachineAnalysis {
  machine: { id: string; title: string; site: string; timezone: string }
  coverage: {
    start: string
    end: string
    samples: number
    expected: number
    gaps: { after: string; before: string; missingHours: number }[]
  }
  power: { meanW: number; peakW: number; peakAt: string; meanDailyWh: number; ceilingDailyWh: number }
  rail: { minV: number; maxV: number; withinTolerance: boolean; monitorChecks: number; monitorAlerts: number }
  thermal: {
    meanCpuC: number
    peakCpuC: number
    peakAt: string
    fanRamps: number
    throttledHours: number
    latest: { at: string; cpuC: number; airC: number; active: boolean }
  }
  activity: { openHour: number; closeHour: number; meanPlayers: number; activeShare: number }
  boots: { resets: number; journaled: number; unjournaledResets: string[]; silent: SilentBoot[] }
  hardwareChanges: HardwareChange[]
  network: { hours: number; errorHours: number; linkDownHours: number }
  checks: ForensicCheck[]
  events: MachineEvent[]
  daily: MachineDay[]
  recent: HourPoint[]
  journal: JournalEntry[]
  maintenance: MaintenanceRecord[]
}

export type Verdict = 'ruled_out' | 'unlikely' | 'open'

export interface Explanation {
  id: string
  claim: string
  source: string
  verdict: Verdict
  evidence: string
}

export interface CrossCheck {
  incident: { date: string; excessKwh: number; extraLoadKw: number }
  budget: { ceilingDailyWh: number; meanDailyWh: number; sharePct: number; yearsOfUse: number }
  coverage: { reachesIncident: boolean; hoursShort: number; lastSampleAt: string }
  explanations: Explanation[]
  checks: ForensicCheck[]
  timeline: MachineEvent[]
}

export interface EvidenceSeal {
  algorithm: 'SHA-256'
  fingerprint: string
  current: string
  sealedAt: string
  checkedAt: string
  intact: boolean
}

export interface MachineReport {
  analysis: MachineAnalysis
  seal: EvidenceSeal
}

export interface MachineCase extends MachineReport {
  log: JanusLog
  verify: () => Promise<EvidenceSeal>
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  ruled_out: 'Ruled out',
  unlikely: 'Doesn’t fit',
  open: 'Open'
}

export function localDate(at: string): string {
  return at.slice(0, 10)
}

export function localTime(at: string): string {
  return at.slice(11, 16)
}

function offsetOf(at: string): string {
  return /([+-]\d{2}:\d{2}|Z)$/.exec(at)?.[1] ?? 'Z'
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function dayStamp(at: string): string {
  return `${formatShortDate(localDate(at))} ${localDate(at).slice(0, 4)}`
}

function stamp(at: string): string {
  return `${dayStamp(at)}, ${localTime(at)}`
}

function isBoot(entry: JournalEntry): boolean {
  return entry.service === 'systemd' && /\bstarted\b/i.test(entry.message)
}

function lastIndexAtOrBefore(times: readonly number[], target: number): number {
  let low = 0
  let high = times.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (times[middle] <= target) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

function buildDaily(log: JanusLog): MachineDay[] {
  const players = new Map(log.daily.map((day) => [day.date, day.players]))
  const groups = new Map<string, HourlySample[]>()
  for (const sample of log.hourly) {
    const date = localDate(sample.at)
    const group = groups.get(date)
    if (group) group.push(sample)
    else groups.set(date, [sample])
  }
  return [...groups].map(([date, samples]) => ({
    date,
    hours: samples.length,
    wh: round1(samples.reduce((sum, sample) => sum + sample.powerW, 0)),
    peakW: round2(Math.max(...samples.map((sample) => sample.powerW))),
    maxCpuC: round1(Math.max(...samples.map((sample) => sample.cpuTempC))),
    meanAirC: round1(mean(samples.map((sample) => sample.airTempC))),
    activeHours: samples.filter((sample) => sample.active).length,
    players: players.get(date) ?? null
  }))
}

function activityWindow(hourly: readonly HourlySample[]) {
  const active = Array.from({ length: 24 }, () => 0)
  const total = Array.from({ length: 24 }, () => 0)
  for (const sample of hourly) {
    const hour = Number(sample.at.slice(11, 13))
    total[hour] += 1
    if (sample.active) active[hour] += 1
  }
  const open = total.map((count, hour) => count > 0 && active[hour] / count > 0.5)
  const first = open.indexOf(true)
  const last = open.lastIndexOf(true)
  return { openHour: Math.max(0, first), closeHour: last < 0 ? 0 : last + 1 }
}

export function analyseMachine(log: JanusLog): MachineAnalysis {
  const { hourly, journal } = log
  const times = hourly.map((sample) => Date.parse(sample.at))
  const first = hourly[0]
  const last = hourly[hourly.length - 1]

  const gaps = hourly.flatMap((sample, index) => {
    if (index === 0) return []
    const missingHours = Math.round((times[index] - times[index - 1]) / HOUR_MS) - 1
    return missingHours > 0 ? [{ after: hourly[index - 1].at, before: sample.at, missingHours }] : []
  })
  const expected = Math.round((times[times.length - 1] - times[0]) / HOUR_MS) + 1

  const peakPower = hourly.reduce((top, sample) => (sample.powerW > top.powerW ? sample : top))
  const peakCpu = hourly.reduce((top, sample) => (sample.cpuTempC > top.cpuTempC ? sample : top))
  const powerMismatches = hourly.filter(
    (sample) => Math.abs(sample.railV * sample.currentA - sample.powerW) > POWER_TOLERANCE_W
  ).length
  const railValues = hourly.map((sample) => sample.railV)
  const minV = Math.min(...railValues)
  const maxV = Math.max(...railValues)
  const withinTolerance =
    Math.abs(minV - RAIL_NOMINAL_V) <= RAIL_NOMINAL_V * RAIL_TOLERANCE &&
    Math.abs(maxV - RAIL_NOMINAL_V) <= RAIL_NOMINAL_V * RAIL_TOLERANCE
  const throttledHours = hourly.filter((sample) => sample.throttled).length

  const resets = hourly.flatMap((sample, index) =>
    index > 0 && sample.uptimeH < hourly[index - 1].uptimeH ? [index] : []
  )
  const boots = journal.filter(isBoot)
  const bootTimes = boots.map((entry) => Date.parse(entry.at))
  const unjournaledResets = resets
    .filter((index) => !bootTimes.some((boot) => times[index] >= boot - 2 * HOUR_MS && times[index] <= boot + HOUR_MS))
    .map((index) => hourly[index].at)

  const hardwareChanges: HardwareChange[] = hourly.flatMap((sample, index) => {
    const previous = hourly[index - 1]
    return previous && sample.memoryMb !== previous.memoryMb
      ? [{ at: sample.at, fromMb: previous.memoryMb, toMb: sample.memoryMb, uptimeBefore: previous.uptimeH, uptimeAfter: sample.uptimeH }]
      : []
  })

  const silent: SilentBoot[] = boots.flatMap((entry, bootIndex) => {
    const boot = bootTimes[bootIndex]
    const reset = resets.some((index) => times[index] >= boot - HOUR_MS && times[index] <= boot + 2 * HOUR_MS)
    if (reset) return []
    const before = lastIndexAtOrBefore(times, boot)
    const after = before + 1
    if (before < 0 || after >= hourly.length) return []
    return [{
      at: entry.at,
      message: entry.message,
      uptimeBefore: hourly[before].uptimeH,
      uptimeAfter: hourly[after].uptimeH,
      hardwareChanged: hardwareChanges.some((change) => Math.abs(Date.parse(change.at) - boot) <= 2 * HOUR_MS)
    }]
  })

  const daily = buildDaily(log)
  const fullDays = daily.filter((day) => day.hours === 24)
  const meanDailyWh = round1(mean((fullDays.length ? fullDays : daily).map((day) => day.wh)))
  const ceilingDailyWh = round1(peakPower.powerW * 24)

  const networkErrorHours = log.network.filter((sample) => sample.rxErrors > 0 || sample.txErrors > 0).length
  const linkDownHours = log.network.filter((sample) => !sample.linkUp).length
  const monitorAlerts = log.power.filter((event) => !/within/i.test(event.status)).length
  const sections = 1 + [log.daily, log.performance, log.network, log.power, log.storage, log.thermal, log.maintenance, log.journal].filter((rows) => rows.length > 0).length
  const totalRows = hourly.length + log.daily.length + log.performance.length + log.network.length + log.power.length + log.storage.length + log.thermal.length + log.maintenance.length + journal.length

  const silentDetail = silent
    .map((boot) => `${stamp(boot.at)}: ${boot.hardwareChanged ? 'controller swapped, ' : ''}uptime ran ${boot.uptimeBefore} → ${boot.uptimeAfter} h`)
    .join('; ')

  const checks: ForensicCheck[] = [
    {
      id: 'continuity',
      passed: gaps.length === 0,
      label: gaps.length ? `${plural(gaps.length, 'gap')} in hourly telemetry` : 'Hourly telemetry is continuous',
      detail: `${formatNumber(hourly.length, 0)} of ${formatNumber(expected, 0)} hours present`
    },
    {
      id: 'rows',
      passed: log.skippedRows === 0,
      label: log.skippedRows ? `${plural(log.skippedRows, 'row')} unreadable` : 'Every row is readable',
      detail: `${formatNumber(totalRows, 0)} rows across ${sections} sections`
    },
    {
      id: 'power',
      passed: powerMismatches === 0,
      label: powerMismatches ? `Power disagrees with V × I in ${plural(powerMismatches, 'hour')}` : 'Power matches rail × current',
      detail: `Checked every hour to ±${POWER_TOLERANCE_W} W`
    },
    {
      id: 'boots',
      passed: silent.length === 0,
      label: silent.length ? `Uptime survived ${plural(silent.length, 'boot')}` : 'Every boot resets uptime',
      detail: silent.length ? silentDetail : `${plural(boots.length, 'boot')} in the journal, each with a reset`
    },
    {
      id: 'reboots',
      passed: unjournaledResets.length === 0,
      label: unjournaledResets.length ? `${plural(unjournaledResets.length, 'reboot')} missing from the journal` : 'Every reboot is in the journal',
      detail: `${plural(resets.length, 'uptime reset')}, ${plural(resets.length - unjournaledResets.length, 'journal match', 'journal matches')}`
    },
    {
      id: 'rail',
      passed: withinTolerance,
      label: withinTolerance ? '5 V rail stayed in tolerance' : '5 V rail left tolerance',
      detail: `${formatNumber(minV, 3)}–${formatNumber(maxV, 3)} V, limit ±${RAIL_TOLERANCE * 100}%`
    },
    {
      id: 'throttle',
      passed: throttledHours === 0,
      label: throttledHours ? `Throttled for ${plural(throttledHours, 'hour')}` : 'No thermal throttling',
      detail: `Peak CPU ${formatNumber(peakCpu.cpuTempC)} °C on ${stamp(peakCpu.at)}`
    },
    {
      id: 'network',
      passed: networkErrorHours === 0 && linkDownHours === 0,
      label: networkErrorHours || linkDownHours ? 'Network errors or drops recorded' : 'Network link stayed clean',
      detail: `${formatNumber(log.network.length, 0)} hours, ${plural(networkErrorHours, 'error hour')}, ${plural(linkDownHours, 'drop')}`
    }
  ]

  const events: MachineEvent[] = [
    {
      at: first.at,
      tone: 'normal',
      title: 'Telemetry begins',
      detail: `Hourly samples from ${log.header.machineTitle}`,
      source: 'logs.janus'
    },
    ...hardwareChanges.map((change) => {
      const continued = change.uptimeAfter > change.uptimeBefore
      return {
        at: change.at,
        tone: (continued ? 'high' : 'normal') as Tone,
        title: 'Controller swapped',
        detail: `Memory ${change.fromMb / 1024} → ${change.toMb / 1024} GB, uptime ${continued ? `kept counting at ${change.uptimeAfter} h` : 'reset'}`,
        source: 'logs.janus'
      }
    }),
    {
      at: last.at,
      tone: 'normal',
      title: 'Telemetry ends',
      detail: `Last sample ${localTime(last.at)}, cabinet ${last.active ? 'active' : 'in standby'} at ${formatNumber(last.cpuTempC)} °C`,
      source: 'logs.janus'
    }
  ]

  return {
    machine: {
      id: log.header.machineId,
      title: log.header.machineTitle,
      site: log.header.site,
      timezone: log.header.timezone
    },
    coverage: { start: first.at, end: last.at, samples: hourly.length, expected, gaps },
    power: {
      meanW: round2(mean(hourly.map((sample) => sample.powerW))),
      peakW: round2(peakPower.powerW),
      peakAt: peakPower.at,
      meanDailyWh,
      ceilingDailyWh
    },
    rail: { minV, maxV, withinTolerance, monitorChecks: log.power.length, monitorAlerts },
    thermal: {
      meanCpuC: round1(mean(hourly.map((sample) => sample.cpuTempC))),
      peakCpuC: round1(peakCpu.cpuTempC),
      peakAt: peakCpu.at,
      fanRamps: log.thermal.length,
      throttledHours,
      latest: { at: last.at, cpuC: last.cpuTempC, airC: last.airTempC, active: last.active }
    },
    activity: {
      ...activityWindow(hourly),
      meanPlayers: round1(mean(log.daily.map((day) => day.players))),
      activeShare: round2(hourly.filter((sample) => sample.active).length / hourly.length)
    },
    boots: { resets: resets.length, journaled: boots.length, unjournaledResets, silent },
    hardwareChanges,
    network: { hours: log.network.length, errorHours: networkErrorHours, linkDownHours },
    checks,
    events,
    daily,
    recent: hourly.slice(-RECENT_HOURS).map((sample) => ({
      at: sample.at,
      powerW: sample.powerW,
      cpuC: sample.cpuTempC,
      airC: sample.airTempC,
      active: sample.active
    })),
    journal,
    maintenance: log.maintenance
  }
}

export function formatShare(percent: number): string {
  if (percent > 0 && percent < 0.01) return '<0.01%'
  return `${formatNumber(percent, percent < 1 ? 2 : 1)}%`
}

export function crossCheck(machine: MachineAnalysis, meter: Analysis): CrossCheck {
  const incidentDate = meter.peak.date
  const excessKwh = round1(meter.excessKwh)
  const extraLoadKw = round1(excessKwh / 24)
  const { ceilingDailyWh, meanDailyWh, peakW } = machine.power
  const ceilingKwh = ceilingDailyWh / 1000
  const sharePct = excessKwh > 0 ? (ceilingKwh / excessKwh) * 100 : 0
  const yearsOfUse = meanDailyWh > 0 ? round1((excessKwh * 1000) / meanDailyWh / DAYS_PER_YEAR) : 0

  const lastSampleAt = machine.coverage.end
  const incidentStart = Date.parse(`${incidentDate}T00:00:00${offsetOf(lastSampleAt)}`)
  const lastSample = Date.parse(lastSampleAt)
  const reachesIncident = lastSample >= incidentStart + 23 * HOUR_MS
  const hoursShort = reachesIncident ? 0 : Math.max(0, Math.round((incidentStart - lastSample) / HOUR_MS))
  const incidentLabel = formatShortDate(incidentDate)

  const silent = machine.boots.silent
  const tamperSigns = [
    ...silent.map((boot) => `Uptime ran on through the ${dayStamp(boot.at)} ${boot.hardwareChanged ? 'board swap' : 'boot'}`),
    ...(reachesIncident ? [] : [`the log stops ${plural(hoursShort, 'hour')} before ${incidentLabel} begins`])
  ]

  const explanations: Explanation[] = [
    {
      id: 'cabinet',
      claim: 'The cabinet drew the energy',
      source: 'Janus',
      verdict: ceilingKwh * RULED_OUT_HEADROOM < excessKwh ? 'ruled_out' : 'open',
      evidence: `Its highest recorded draw, ${formatNumber(peakW, 1)} W, allows ${formatNumber(ceilingKwh, 2)} kWh a day: ${formatShare(sharePct)} of the ${formatNumber(excessKwh, 0)} kWh excess.`
    },
    {
      id: 'hvac',
      claim: 'HVAC compressor startup',
      source: 'Energy Dossier',
      verdict: 'unlikely',
      evidence: `A startup surge lasts seconds. The excess needs about ${formatNumber(extraLoadKw, 0)} kW of extra load held for a full day.`
    },
    {
      id: 'harmonics',
      claim: 'Harmonics from switching electronics',
      source: 'Energy Dossier',
      verdict: machine.rail.withinTolerance ? 'unlikely' : 'open',
      evidence: `The cabinet supply held ${formatNumber(machine.rail.minV, 2)}–${formatNumber(machine.rail.maxV, 2)} V across ${plural(machine.rail.monitorChecks, 'monitor check')}. Distortion typically skews a meter by percent, not ${Math.round(meter.peakFactor)}×.`
    },
    {
      id: 'phase',
      claim: 'Minor phase imbalance',
      source: 'Energy Dossier',
      verdict: 'unlikely',
      evidence: 'The Dossier itself records that no single phase accounts for the demand excursion.'
    },
    {
      id: 'meter',
      claim: 'Meter register fault',
      source: 'Janus',
      verdict: 'open',
      evidence: `A one-off register jump would read the same way. The meter returns to about ${formatNumber(meter.baseline)} kWh a day afterwards; it needs a bench test.`
    },
    ...(tamperSigns.length
      ? [{
          id: 'edited',
          claim: 'Cabinet telemetry was edited',
          source: 'Janus',
          verdict: 'open' as Verdict,
          evidence: `${tamperSigns.join(', and ')}.`.replace(/^./, (char) => char.toUpperCase())
        }]
      : [])
  ]

  const coverageCheck: ForensicCheck = {
    id: 'coverage',
    passed: reachesIncident,
    label: reachesIncident ? `Telemetry covers ${incidentLabel}` : `Telemetry stops before ${incidentLabel}`,
    detail: reachesIncident
      ? `Last sample ${stamp(lastSampleAt)}`
      : `Last sample ${stamp(lastSampleAt)}, ${plural(hoursShort, 'hour')} before the spike day`
  }

  const meterEvents: MachineEvent[] = meter.days.flatMap((day) => {
    if (day.spike) {
      return [{
        at: day.date,
        tone: 'critical' as Tone,
        title: 'Meter spike',
        detail: `+${formatNumber(day.delta ?? day.usage, 0)} kWh, ${Math.round((day.delta ?? day.usage) / meter.baseline)}× baseline`,
        source: 'Energy Dossier'
      }]
    }
    if (day.mismatch) {
      return [{
        at: day.date,
        tone: 'high' as Tone,
        title: 'Log doesn’t match meter',
        detail: `Logged ${formatNumber(day.usage)} kWh, meter moved ${formatNumber(day.delta ?? 0)} kWh`,
        source: 'Energy Dossier'
      }]
    }
    return []
  })

  const timeline = [
    ...machine.events.map((event) =>
      event.title === 'Telemetry ends' && !reachesIncident
        ? { ...event, tone: 'critical' as Tone, detail: `Last sample ${localTime(event.at)}, ${plural(hoursShort, 'hour')} before the spike day` }
        : event
    ),
    ...meterEvents,
    ...CASE_FILE.map((report) => ({
      at: report.date,
      tone: 'medium' as Tone,
      title: report.title,
      detail: report.detail,
      source: report.source
    }))
  ].sort((a, b) => a.at.localeCompare(b.at))

  return {
    incident: { date: incidentDate, excessKwh, extraLoadKw },
    budget: { ceilingDailyWh, meanDailyWh, sharePct, yearsOfUse },
    coverage: { reachesIncident, hoursShort, lastSampleAt },
    explanations,
    checks: [coverageCheck, ...machine.checks].sort((a, b) => Number(a.passed) - Number(b.passed)),
    timeline
  }
}
