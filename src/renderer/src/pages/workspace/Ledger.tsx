import { useState } from 'react'
import { isFlagged, type Analysis, type DayRecord } from '@shared/meter'
import { formatNumber, formatShortDate } from '@/lib/format'
import Widget from './Widget'
import styles from './Ledger.module.css'

type Status = 'spike' | 'mismatch' | 'future' | 'unverified' | 'ok'
type Filter = 'all' | 'flagged'

const STATUS_LABELS: Record<Status, string> = {
  spike: 'Spike',
  mismatch: 'Mismatch',
  future: 'Future',
  unverified: 'No prior',
  ok: 'OK'
}

const BAR_CAP_KWH = 60

function statusOf(day: DayRecord): Status {
  if (day.spike) return 'spike'
  if (day.mismatch) return 'mismatch'
  if (day.future) return 'future'
  if (day.delta === null) return 'unverified'
  return 'ok'
}

function barShare(value: number): string {
  return `${(Math.min(value, BAR_CAP_KWH) / BAR_CAP_KWH) * 100}%`
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`
}

interface LedgerWidgetProps {
  analysis: Analysis
  area: string
  revealed: boolean
}

export default function LedgerWidget({ analysis, area, revealed }: LedgerWidgetProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const { days, ledgerGapKwh, loggedKwh, meteredKwh } = analysis
  const flagged = days.filter(isFlagged)
  const rows = filter === 'all' ? days : flagged

  const tabs = [
    { id: 'all', label: 'All', count: days.length },
    { id: 'flagged', label: 'Flagged', count: flagged.length }
  ] as const

  return (
    <Widget
      area={area}
      title="Meter log"
      revealed={revealed}
      meta={
        <div className={styles.tabs} role="group" aria-label="Filter entries">
          {tabs.map(({ id, label, count }) => (
            <button
              key={id}
              className={styles.tab}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              <span className={styles.count}>{count}</span>
            </button>
          ))}
        </div>
      }
    >
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.wide}>
                #
              </th>
              <th scope="col">Date</th>
              <th scope="col" className={styles.number}>
                Reading
              </th>
              <th scope="col" className={styles.number}>
                Logged
              </th>
              <th scope="col" className={styles.number}>
                Meter Δ
              </th>
              <th scope="col" className={`${styles.number} ${styles.wide}`}>
                Diff
              </th>
              <th scope="col" className={styles.barColumn}>
                Usage
              </th>
              <th scope="col" className={styles.statusColumn}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((day) => {
              const status = statusOf(day)
              const diff = day.delta === null ? null : day.usage - day.delta
              return (
                <tr key={day.date} data-status={status}>
                  <td className={`${styles.muted} ${styles.wide}`}>{days.indexOf(day) + 1}</td>
                  <td>
                    <span className={styles.dot} data-status={status} />
                    {formatShortDate(day.date)}
                  </td>
                  <td className={styles.number}>{formatNumber(day.reading)}</td>
                  <td className={styles.number} data-flag={day.mismatch || day.spike || undefined}>
                    {formatNumber(day.usage)}
                  </td>
                  <td className={styles.number}>
                    {day.delta === null ? '—' : formatNumber(day.delta)}
                  </td>
                  <td
                    className={`${styles.number} ${styles.wide} ${diff === 0 ? styles.muted : ''}`}
                    data-off={day.mismatch || undefined}
                  >
                    {diff === null ? '—' : signed(diff)}
                  </td>
                  <td className={styles.barColumn}>
                    <span className={styles.bar} data-status={status}>
                      <span className={styles.barFill} style={{ width: barShare(day.usage) }} />
                      {day.delta !== null && (
                        <span className={styles.barTick} style={{ left: barShare(day.delta) }} />
                      )}
                    </span>
                  </td>
                  <td className={styles.statusColumn}>
                    <span className={styles.chip} data-status={status}>
                      {STATUS_LABELS[status]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {filter === 'all' && (
            <tfoot>
              <tr>
                <td className={styles.wide} />
                <td title="Totals cover the days that have a prior reading">Total</td>
                <td />
                <td className={styles.number}>{formatNumber(loggedKwh)}</td>
                <td className={styles.number}>{formatNumber(meteredKwh)}</td>
                <td className={`${styles.number} ${styles.wide}`} data-off>
                  {signed(ledgerGapKwh)}
                </td>
                <td className={styles.barColumn} />
                <td className={styles.statusColumn} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Widget>
  )
}
