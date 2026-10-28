import { ShieldAlert } from 'lucide-react'
import { SUSPENSION } from '@shared/caseFile'
import Button from '@/components/Button'
import DecryptText from '@/components/DecryptText'
import Panel from '@/components/Panel'
import { formatLongDate } from '@/lib/format'
import styles from './NoticePage.module.css'

const FIELDS = [
  { label: 'Reference', value: SUSPENSION.reference },
  { label: 'Effective', value: formatLongDate(SUSPENSION.effective) },
  { label: 'Classification', value: SUSPENSION.classification },
  { label: 'Issued by', value: SUSPENSION.issuer }
]

interface NoticePageProps {
  onAcknowledge: () => void
}

export default function NoticePage({ onAcknowledge }: NoticePageProps) {
  return (
    <main className={styles.page}>
      <p className={styles.kicker}>
        <DecryptText text="Incoming directive" />
      </p>

      <Panel
        as="h1"
        title="Suspension of operational authority"
        icon={<ShieldAlert className={styles.icon} size={22} aria-hidden="true" />}
        className={styles.notice}
      >
        <dl className={styles.fields}>
          {FIELDS.map(({ label, value }) => (
            <div key={label} className={styles.field}>
              <dt className={styles.label}>{label}</dt>
              <dd className={styles.value}>{value}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.body}>
          EXUN is suspended, effective immediately. The Agency calls the Wenoti Arcade findings
          inconclusive.
        </p>

        <Button className={styles.action} onClick={onAcknowledge}>
          Acknowledge receipt
        </Button>
      </Panel>
    </main>
  )
}
