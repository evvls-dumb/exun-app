import { formatShare, localDate, type CrossCheck, type EvidenceSeal, type MachineAnalysis, type MachineEvent } from '@shared/machine'
import type { Analysis } from '@shared/meter'
import { formatNumber, formatShortDate } from '@/lib/format'
import DayStrip, { type StripDay } from './DayStrip'
import styles from './Summary.module.css'
import own from './CabinetSummary.module.css'

const MIN_MARK_PERCENT = 1.2
const HIDDEN_EVENTS = new Set(['Telemetry begins', 'Log doesn’t match meter'])

function eventDate(event: MachineEvent, year: string): string {
  const date = localDate(event.at)
  const day = formatShortDate(date)
  return date.startsWith(year) ? day : `${day} ${date.slice(0, 4)}`
}

function coverageDays(meter: Analysis, machine: MachineAnalysis): StripDay[] {
  const first = localDate(machine.coverage.start)
  const last = localDate(machine.coverage.end)
  return meter.days.map((day) => {
    const covered = day.date >= first && day.date <= last
    return {
      key: day.date,
      tone: covered ? 'normal' : 'missing',
      date: formatShortDate(day.date),
      value: `${formatNumber(day.delta ?? day.usage)} kWh metered`,
      status: covered ? 'Telemetry' : 'No telemetry'
    }
  })
}

interface CabinetSummaryProps {
  meter: Analysis
  analysis: MachineAnalysis
  cross: CrossCheck
  seal: EvidenceSeal
}

export default function CabinetSummary({ meter, analysis, cross, seal }: CabinetSummaryProps) {
  const { budget, incident } = cross
  const year = incident.date.slice(0, 4)
  const review = cross.checks.filter((check) => !check.passed).length
  const open = cross.explanations.filter((item) => item.verdict === 'open').length
  const peakKw = analysis.power.peakW / 1000
  const share = formatShare(budget.sharePct).replace('%', '')
  const strip = coverageDays(meter, analysis)
  const covered = strip.filter((day) => day.tone === 'normal').length
  const timeline = cross.timeline.filter((event) => !HIDDEN_EVENTS.has(event.title))
  const silent = analysis.boots.silent.length

  const metrics = [
    {
      label: 'Average cabinet draw',
      short: 'Avg draw',
      value: formatNumber(analysis.power.meanW),
      unit: 'W',
      note: `${formatNumber(budget.meanDailyWh, 0)} Wh a day`
    },
    {
      label: 'Hottest CPU reading',
      short: 'Peak CPU',
      value: formatNumber(analysis.thermal.peakCpuC),
      unit: '°C',
      note: `${formatShortDate(localDate(analysis.thermal.peakAt))} ${localDate(analysis.thermal.peakAt).slice(0, 4)}`
    },
    {
      label: 'Reboots in the telemetry',
      short: 'Reboots',
      value: String(analysis.boots.resets),
      unit: '',
      note: silent ? `${silent} without reset` : 'all journaled'
    }
  ]

  return (
    <div className={styles.summary}>
      <div className={styles.content}>
        <ul className={styles.severities} aria-label="Case status">
          <li
            className={`${styles.severity} ${own.chip}`}
            data-tone={seal.intact ? 'sealed' : 'broken'}
            title={`SHA-256 ${seal.current}`}
          >
            {seal.intact ? 'Seal intact' : 'Seal broken'}
          </li>
          {review > 0 && (
            <li className={`${styles.severity} ${own.chip}`} data-tone="high">
              {review} to review
            </li>
          )}
          {open > 0 && (
            <li className={`${styles.severity} ${own.chip}`} data-tone="medium">
              {open} open {open === 1 ? 'lead' : 'leads'}
            </li>
          )}
        </ul>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Cabinet’s share of the {formatShortDate(incident.date)} excess</p>
          <p className={styles.headline}>
            {share}
            <span className={`${styles.unit} ${own.percent}`}>%</span>
          </p>
          <p className={styles.context}>
            At most {formatNumber(budget.ceilingDailyWh / 1000, 2)} kWh a day against{' '}
            {formatNumber(incident.excessKwh, 0)} kWh
          </p>

          <DayStrip label="Telemetry coverage across the meter period" days={strip} />
          <p className={`${styles.stripNote} ${own.keep}`}>
            Telemetry covers {covered} of {strip.length} meter days
          </p>
        </section>

        <section
          className={styles.load}
          aria-label="Load the spike needs against the cabinet’s peak"
          title="Excess energy above baseline spread over 24 hours, against the highest draw in the telemetry"
        >
          <div className={styles.loadHead}>
            <span>Extra load on {formatShortDate(incident.date)}</span>
            <span className={styles.loadValue}>{formatNumber(incident.extraLoadKw)} kW</span>
          </div>
          <span className={styles.track}>
            <span className={styles.fill} />
            <span
              className={styles.mark}
              style={{ left: `${Math.max(MIN_MARK_PERCENT, (peakKw / incident.extraLoadKw) * 100)}%` }}
            />
          </span>
          <p className={styles.loadNote}>
            Cabinet peak {formatNumber(analysis.power.peakW)} W,{' '}
            {formatNumber(Math.round(incident.extraLoadKw / peakKw), 0)}× lower
          </p>
        </section>

        <dl className={styles.metrics}>
          {metrics.map(({ label, short, value, unit, note }) => (
            <div key={label} className={styles.metric} title={label}>
              <dt className={styles.metricLabel}>{short}</dt>
              <dd className={styles.metricValue}>
                {value}
                {unit && <span className={own.metricUnit}>{unit}</span>}
              </dd>
              <dd className={styles.metricNote}>{note}</dd>
            </div>
          ))}
        </dl>

        <section className={styles.timelineSection}>
          <h3 className={styles.sectionTitle}>Timeline</h3>
          <ol className={styles.timeline}>
            {timeline.map((event) => (
              <li
                key={`${event.at}-${event.title}`}
                className={styles.event}
                data-tone={event.tone}
                title={`Source: ${event.source}`}
              >
                <span className={styles.marker} aria-hidden="true" />
                <div className={styles.eventBody}>
                  <p className={styles.eventHead}>
                    <span className={styles.eventTitle}>{event.title}</span>
                    <span className={styles.eventDate}>{eventDate(event, year)}</span>
                  </p>
                  <p className={styles.eventDetail}>{event.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
