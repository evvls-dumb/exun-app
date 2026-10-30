import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Analysis, DayRecord, Tone, TimelineEvent } from '@shared/meter'
import { formatNumber, formatShortDate } from '@/lib/format'
import styles from './Summary.module.css'

const CARET_INSET_PX = 16

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

  const [shown, setShown] = useState(0)
  const [visible, setVisible] = useState(false)
  const [instant, setInstant] = useState(true)
  const [tip, setTip] = useState({ x: 0, caret: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])

  function showTip(index: number) {
    if (!visible) setInstant(true)
    setShown(index)
    setVisible(true)
  }

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const pill = tipRef.current
    const item = itemRefs.current[shown]
    if (!visible || !wrap || !pill || !item) return

    const centre = item.offsetLeft + item.offsetWidth / 2
    const x = Math.min(Math.max(centre - pill.offsetWidth / 2, 0), wrap.clientWidth - pill.offsetWidth)
    const caret = Math.min(
      Math.max(centre - x, CARET_INSET_PX),
      pill.offsetWidth - CARET_INSET_PX
    )
    setTip({ x, caret })

    if (!instant) return
    const frame = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(frame)
  }, [shown, visible, instant])

  const shownDay = days[shown]
  const shownTone = dayTone(shownDay)

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

          <div ref={wrapRef} className={styles.stripWrap}>
            <ul
              className={styles.strip}
              aria-label="Days across the period"
              onPointerLeave={() => setVisible(false)}
            >
              {days.map((day, index) => {
                const tone = dayTone(day)
                return (
                  <li
                    key={day.date}
                    ref={(element) => {
                      itemRefs.current[index] = element
                    }}
                    className={styles.day}
                    data-tone={tone}
                    data-active={(visible && shown === index) || undefined}
                    style={{ animationDelay: `${index * 28}ms` }}
                    onPointerEnter={() => showTip(index)}
                  >
                    <span className="sr-only">
                      {formatShortDate(day.date)}: {formatNumber(day.usage)} kWh, {TONE_LABELS[tone]}
                    </span>
                  </li>
                )
              })}
            </ul>

            <div
              ref={tipRef}
              className={styles.tip}
              data-tone={shownTone}
              data-visible={visible || undefined}
              data-instant={instant || undefined}
              style={{ '--x': `${tip.x}px`, '--caret': `${tip.caret}px` } as CSSProperties}
              aria-hidden="true"
            >
              <span className={styles.tipDot} />
              <span className={styles.tipDate}>{formatShortDate(shownDay.date)}</span>
              <span className={styles.tipValue}>{formatNumber(shownDay.usage)} kWh</span>
              <span className={styles.tipStatus}>{TONE_LABELS[shownTone]}</span>
            </div>
          </div>
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
