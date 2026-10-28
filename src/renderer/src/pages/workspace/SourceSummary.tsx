import type { Tone } from '@shared/meter'
import type { SourceAnalysis } from '@shared/source'
import { formatShortDate } from '@/lib/format'
import styles from './Summary.module.css'
import own from './CabinetSummary.module.css'

interface Finding {
  tone: Tone
  title: string
  detail: string
  source: string
}

interface SourceSummaryProps {
  analysis: SourceAnalysis
  recoveredOn: string
}

export default function SourceSummary({ analysis, recoveredOn }: SourceSummaryProps) {
  const removed = analysis.removedClasses
  const names = removed.map((item) => item.name).join(', ')
  const total = analysis.original.lines.length
  const share = (analysis.removedLines / total) * 100
  const uses = analysis.dangling.length
  const users = [
    ...new Set(
      analysis.dangling.flatMap((use) =>
        analysis.recovered.classes
          .filter((item) => use.line >= item.startLine && use.line <= item.endLine)
          .map((item) => item.name)
      )
    )
  ]

  const findings: Finding[] = [
    ...removed.map((item) => ({
      tone: 'critical' as Tone,
      title: `${item.name} class removed`,
      detail: `Lines ${item.startLine}–${item.endLine} of the original are gone`,
      source: 'Source diff'
    })),
    ...(analysis.compiles
      ? []
      : [
          {
            tone: 'high' as Tone,
            title: 'Recovered source can’t compile',
            detail: `${names} is used on ${uses} lines but never declared`,
            source: 'Source diff'
          },
          {
            tone: 'high' as Tone,
            title: 'Edited after the build',
            detail: 'A running game is consistent with a binary built before the class was removed',
            source: 'Janus inference'
          }
        ]),
    {
      tone: 'medium',
      title: 'Matches the agents’ report',
      detail: `Code analysts reported a missing class on ${formatShortDate(recoveredOn)}`,
      source: 'Progress Assessment Log'
    }
  ]

  const metrics = [
    {
      label: 'Classes declared',
      short: 'Classes',
      value: `${analysis.original.classes.length}→${analysis.recovered.classes.length}`,
      note: `${removed.length} removed`
    },
    { label: 'Lines removed', short: 'Removed', value: String(analysis.removedLines), note: `of ${total} lines` },
    { label: 'Lines added', short: 'Added', value: String(analysis.addedLines), note: analysis.addedLines ? 'lines' : 'nothing new' }
  ]

  return (
    <div className={styles.summary}>
      <div className={styles.content}>
        <ul className={styles.severities} aria-label="Source status">
          <li className={`${styles.severity} ${own.chip}`} data-tone="critical">
            {removed.length} {removed.length === 1 ? 'class' : 'classes'} removed
          </li>
          <li
            className={`${styles.severity} ${own.chip}`}
            data-tone={analysis.compiles ? 'sealed' : 'high'}
          >
            {analysis.compiles ? 'Compiles' : 'Won’t compile'}
          </li>
        </ul>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Lines still using the missing class</p>
          <p className={styles.headline}>
            {uses}
            <span className={styles.unit}>lines</span>
          </p>
          <p className={styles.context}>
            {names || 'Nothing'} is gone{users.length ? `, but ${users.join(' and ')} still call it` : ''}
          </p>
        </section>

        <section className={styles.load} aria-label="Share of the source removed">
          <div className={styles.loadHead}>
            <span>Source removed</span>
            <span className={styles.loadValue}>
              {analysis.removedLines} of {total} lines
            </span>
          </div>
          <span className={styles.track}>
            <span className={styles.fill} style={{ width: `${share}%` }} />
          </span>
          <p className={styles.loadNote}>Everything else matches the original line for line</p>
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
          <h3 className={styles.sectionTitle}>Findings</h3>
          <ol className={styles.timeline}>
            {findings.map((finding) => (
              <li key={finding.title} className={styles.event} data-tone={finding.tone} title={`Source: ${finding.source}`}>
                <span className={styles.marker} aria-hidden="true" />
                <div className={styles.eventBody}>
                  <p className={styles.eventHead}>
                    <span className={styles.eventTitle}>{finding.title}</span>
                  </p>
                  <p className={styles.eventDetail}>{finding.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
