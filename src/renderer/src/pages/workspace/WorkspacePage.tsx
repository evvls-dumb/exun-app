import { folderName } from '@/lib/path'
import type { Session } from '@shared/session'
import styles from './WorkspacePage.module.css'

interface WorkspacePageProps {
  session: Session
}

export default function WorkspacePage({ session }: WorkspacePageProps) {
  return (
    <main className={styles.page}>
      <h1 className={styles.name}>{folderName(session.logsPath)}</h1>
      <p className={styles.path}>{session.logsPath}</p>
    </main>
  )
}
