import styles from './ChartTip.module.css'

export type TipTone = 'critical' | 'warning' | 'info' | 'neutral'

interface TipRow {
  label: string
  value: string
  tone?: TipTone
}

interface ChartTipProps {
  title: string
  rows: readonly TipRow[]
  status: { label: string; tone: TipTone }
  note?: string
}

export default function ChartTip({ title, rows, status, note }: ChartTipProps) {
  return (
    <div className={styles.tip}>
      <p className={styles.title}>{title}</p>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt className={styles.label}>{row.label}</dt>
            <dd className={styles.value} data-tone={row.tone}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.status} data-tone={status.tone}>
        {status.label}
      </p>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  )
}
