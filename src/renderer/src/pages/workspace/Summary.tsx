import type { Analysis, DayRecord, Tone, TimelineEvent } from '@shared/meter'
import { formatNumber, formatShortDate } from '@/lib/format'
import DayStrip from './DayStrip'
import styles from './Summary.module.css'

const SEVERITIES = ['critical', 'high', 'medium'] as const
const MIN_MARK_PERCENT = 1.2

const TONE_LABELS: Record<Tone, string> = {
  critical: 'Spike',
  high: 'Mismatch',
  medium: 'Future-dated',
  normal: 'Normal'
}

function dayTone(day: DayRecord): Tone {
  if (day.spike) return 'critical'
  if (day.mismatch) return 'high'
  if (day.future) return 'medium'
  return 'normal'
}

function eventDates(event: TimelineEvent): string {
  if (!event.endDate) return formatShortDate(event.date)
  const sameMonth = event.date.slice(0, 7) === event.endDate.slice(0, 7)
  const end = sameMonth ? String(Number(event.endDate.slice(8))) : formatShortDate(event.endDate)
  return `${formatShortDate(event.date)} – ${end}`
}

interface SummaryProps {
  analysis: Analysis
}

export default function Summary({ analysis }: SummaryProps) {
  const {
    baseline,
    baselineLoadKw,
    counts,
    days,
    excessKwh,
    ledgerGapKwh,
    peak,
    peakFactor,
    peakLoadKw,
    timeline
  } = analysis

  const mismatchDay = days.find((day) => day.mismatch && !day.spike)
  const flaggedDays = counts.critical + counts.high + counts.medium

  const metrics = [
    { label: 'Baseline usage', short: 'Baseline', value: formatNumber(baseline), note: 'kWh/day' },
    {
      label: 'Peak against baseline',
      short: 'Peak',
      value: `${Math.round(peakFactor)}×`,
      note: formatShortDate(peak.date)
    },
    {
      label: 'Log against meter gap',
      short: 'Log gap',
      value: formatNumber(ledgerGapKwh),
      note: mismatchDay ? `kWh · ${formatShortDate(mismatchDay.date)}` : 'kWh'
    }
  ]

  return (
    <div className={styles.summary}>
      <div className={styles.content}>
        <ul className={styles.severities} aria-label="Findings by severity">
          {SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
            <li key={severity} className={styles.severity} data-tone={severity}>
              {counts[severity]} {severity}
            </li>
          ))}
        </ul>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Unexplained energy above baseline</p>
          <p className={styles.headline}>
            {formatNumber(excessKwh, 0)}
            <span className={styles.unit}>kWh</span>
          </p>
          <p className={styles.context}>
            On {formatShortDate(peak.date)} · about {Math.round(excessKwh / baseline)} days of normal
            use
          </p>

          <DayStrip
            label="Days across the period"
            days={days.map((day) => {
              const tone = dayTone(day)
              return {
                key: day.date,
                tone,
                date: formatShortDate(day.date),
                value: `${formatNumber(day.usage)} kWh`,
                status: TONE_LABELS[tone]
              }
            })}
          />
          <p className={styles.stripNote}>
            {flaggedDays} of {days.length} days flagged
          </p>
        </section>

        <section
          className={styles.load}
          aria-label={`Average load on ${formatShortDate(peak.date)}`}
          title="Derived from the daily meter change divided by 24 hours"
        >
          <div className={styles.loadHead}>
            <span>Implied load on {formatShortDate(peak.date)}</span>
            <span className={styles.loadValue}>{formatNumber(peakLoadKw)} kW</span>
          </div>
          <span className={styles.track}>
            <span className={styles.fill} />
            <span
              className={styles.mark}
              style={{ left: `${Math.max(MIN_MARK_PERCENT, (baselineLoadKw / peakLoadKw) * 100)}%` }}
            />
          </span>
          <p className={styles.loadNote}>
            Typical day {formatNumber(baselineLoadKw, 2)} kW, {Math.round(peakLoadKw / baselineLoadKw)}×
            lower
          </p>
        </section>

        <dl className={styles.metrics}>
          {metrics.map(({ label, short, value, note }) => (
            <div key={label} className={styles.metric} title={label}>
              <dt className={styles.metricLabel}>{short}</dt>
              <dd className={styles.metricValue}>{value}</dd>
              <dd className={styles.metricNote}>{note}</dd>
            </div>
          ))}
        </dl>

        <section className={styles.timelineSection}>
          <h3 className={styles.sectionTitle}>Timeline</h3>
          <ol className={styles.timeline}>
            {timeline.map((event) => (
              <li key={event.date} className={styles.event} data-tone={event.tone}>
                <span className={styles.marker} aria-hidden="true" />
                <div className={styles.eventBody}>
                  <p className={styles.eventHead}>
                    <span className={styles.eventTitle}>{event.title}</span>
                    <span className={styles.eventDate}>{eventDates(event)}</span>
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
