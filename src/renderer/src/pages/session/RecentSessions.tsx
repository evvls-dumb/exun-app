import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import Panel from '@/components/Panel'
import { formatDateTime } from '@/lib/format'
import type { Session } from '@shared/session'
import styles from './RecentSessions.module.css'

const MAX_RECENT = 5

interface RecentSessionsProps {
  onOpen: (session: Session) => void
}

export default function RecentSessions({ onOpen }: RecentSessionsProps) {
  const [sessions, setSessions] = useState<Session[] | null>(null)

  useEffect(() => {
    let current = true

    window.janus.sessions
      .list()
      .catch(() => [])
      .then((list) => {
        if (current) setSessions(list.slice(0, MAX_RECENT))
      })

    return () => {
      current = false
    }
  }, [])

  async function open(id: string) {
    onOpen(await window.janus.sessions.open(id))
  }

  return (
    <Panel title="Recent sessions" className={styles.recent}>
      {sessions?.length === 0 && (
        <div className={styles.empty}>
          <History size={32} strokeWidth={1.5} aria-hidden="true" />
          <p className={styles.emptyText}>Nothing Here :(</p>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className={styles.list}>
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                className={styles.row}
                type="button"
                disabled={!session.available}
                onClick={() => open(session.id)}
              >
                <span className={styles.date}>{formatDateTime(session.lastOpenedAt)}</span>
                {!session.available && <span className={styles.note}>Logs file missing</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
