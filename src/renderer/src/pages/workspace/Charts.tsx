import type { Analysis } from '@shared/meter'
import ReadingLine from '@/components/charts/ReadingLine'
import UsageBars from '@/components/charts/UsageBars'
import styles from './Charts.module.css'

interface ChartProps {
  analysis: Analysis
}

const USAGE_KEYS = [
  { label: 'Logged', color: 'var(--color-accent-bright)' },
  { label: 'Spike', color: 'var(--color-danger)' },
  { label: 'Mismatch', color: 'var(--color-warn)' }
] as const

export function UsageLegend() {
  return (
    <>
      {USAGE_KEYS.map(({ label, color }) => (
        <span key={label} className={styles.key}>
          <span className={styles.swatch} style={{ background: color }} />
          {label}
        </span>
      ))}
      <span className={styles.key}>
        <span className={styles.dot} />
        Meter Δ
      </span>
    </>
  )
}

export function UsageChart({ analysis }: ChartProps) {
  return <UsageBars analysis={analysis} />
}

export function ReadingChart({ analysis }: ChartProps) {
  return <ReadingLine analysis={analysis} />
}
