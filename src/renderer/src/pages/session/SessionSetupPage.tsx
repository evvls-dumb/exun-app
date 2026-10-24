import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import logo from '@assets/logo.png'
import Button from '@/components/Button'
import Panel from '@/components/Panel'
import PathField from '@/components/PathField'
import { useLogsFile } from '@/hooks/useLogsFile'
import type { Session } from '@shared/session'
import RecentSessions from './RecentSessions'
import styles from './SessionSetupPage.module.css'

interface SessionSetupPageProps {
  onSessionOpen: (session: Session) => void
}

export default function SessionSetupPage({ onSessionOpen }: SessionSetupPageProps) {
  const logsFile = useLogsFile()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startSession() {
    if (logsFile.status !== 'found') return
    setStarting(true)
    setError(null)
    try {
      onSessionOpen(await window.janus.sessions.create(logsFile.path))
    } catch {
      setError('The logs file can’t be read. Run the CLI to pull it again.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.layout}>
        <Panel
          as="h1"
          title="Initialize a new session"
          icon={<img className={styles.mark} src={logo} alt="" draggable={false} />}
          className={styles.setup}
        >
          <span className={styles.label}>Logs file</span>

          {logsFile.status === 'missing' ? (
            <div className={styles.notice} role="status">
              <CircleAlert className={styles.noticeIcon} size={18} aria-hidden="true" />
              <p className={styles.noticeTitle}>Auto detection of Logs files failed</p>
              <p className={styles.noticeText}>
                Please run the CLI to pull the logs file from the machine.
              </p>
            </div>
          ) : (
            <PathField
              path={logsFile.status === 'found' ? logsFile.path : null}
              label="Logs file"
              placeholder="Detecting logs file…"
            />
          )}

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <Button
            className={styles.start}
            onClick={startSession}
            disabled={logsFile.status !== 'found' || starting}
          >
            Start session
          </Button>
        </Panel>

        <RecentSessions onOpen={onSessionOpen} />
      </div>
    </main>
  )
}
