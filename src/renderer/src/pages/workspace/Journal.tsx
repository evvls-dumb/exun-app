import { useMemo, useState } from 'react'
import type { JournalEntry } from '@shared/janus'
import { localDate, localTime } from '@shared/machine'
import { formatShortDate } from '@/lib/format'
import Widget from './Widget'
import ledger from './Ledger.module.css'
import styles from './Journal.module.css'

type Filter = 'all' | 'warnings' | 'boots'

const FILTERS: Record<Filter, (entry: JournalEntry) => boolean> = {
  all: () => true,
  warnings: (entry) => entry.level !== 'INFO',
  boots: (entry) => entry.service === 'systemd'
}

const LABELS: Record<Filter, string> = {
  all: 'All',
  warnings: 'Warnings',
  boots: 'Boots'
}

interface JournalWidgetProps {
  journal: readonly JournalEntry[]
  flagged: readonly string[]
  area: string
}

export default function JournalWidget({ journal, flagged, area }: JournalWidgetProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const newest = useMemo(() => [...journal].reverse(), [journal])
  const suspicious = useMemo(() => new Set(flagged), [flagged])
  const rows = newest.filter(FILTERS[filter])

  return (
    <Widget
      area={area}
      title="System journal"
      revealed
      meta={
        <div className={ledger.tabs} role="group" aria-label="Filter journal">
          {(Object.keys(FILTERS) as Filter[]).map((id) => (
            <button
              key={id}
              className={ledger.tab}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {LABELS[id]}
              <span className={ledger.count}>{newest.filter(FILTERS[id]).length}</span>
            </button>
          ))}
        </div>
      }
    >
      <div className={ledger.scroll}>
        <table className={ledger.table}>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col" className={styles.message}>
                Entry
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, index) => {
              const flag = suspicious.has(entry.at)
              return (
                <tr
                  key={`${entry.at}-${index}`}
                  data-level={entry.level}
                  data-flag={flag || undefined}
                  title={flag ? 'Uptime kept counting after this boot' : entry.message}
                >
                  <td className={ledger.muted}>
                    {formatShortDate(localDate(entry.at))} ’{localDate(entry.at).slice(2, 4)}
                    <span className={styles.time}>{localTime(entry.at)}</span>
                  </td>
                  <td className={styles.message}>
                    <span className={styles.service} data-level={entry.level}>
                      {entry.service}
                    </span>
                    {entry.message}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Widget>
  )
}
