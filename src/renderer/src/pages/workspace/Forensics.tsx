import { CircleAlert, CircleCheck } from 'lucide-react'
import type { ForensicCheck } from '@shared/machine'
import styles from './MachineLists.module.css'

interface ForensicsProps {
  checks: readonly ForensicCheck[]
}

export default function Forensics({ checks }: ForensicsProps) {
  return (
    <ul className={styles.list}>
      {checks.map((check, index) => (
        <li
          key={check.id}
          className={`${styles.row} ${styles.compact}`}
          data-passed={check.passed || undefined}
          style={{ animationDelay: `${index * 30}ms` }}
          title={check.detail}
        >
          <span className={styles.status} aria-label={check.passed ? 'Passed' : 'Needs review'}>
            {check.passed ? (
              <CircleCheck size={15} aria-hidden="true" />
            ) : (
              <CircleAlert size={15} aria-hidden="true" />
            )}
          </span>
          <div className={styles.text}>
            <p className={styles.title}>{check.label}</p>
            <p className={`${styles.detail} ${styles.single}`}>{check.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
