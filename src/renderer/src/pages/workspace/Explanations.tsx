import { VERDICT_LABELS, type Explanation } from '@shared/machine'
import styles from './MachineLists.module.css'

interface ExplanationsProps {
  explanations: readonly Explanation[]
}

export default function Explanations({ explanations }: ExplanationsProps) {
  return (
    <ul className={styles.list}>
      {explanations.map((item, index) => (
        <li key={item.id} className={styles.row} style={{ animationDelay: `${index * 40}ms` }}>
          <div className={styles.text}>
            <p className={styles.title}>
              {item.claim}
              <span className={styles.source}>{item.source}</span>
            </p>
            <p className={styles.detail}>{item.evidence}</p>
          </div>
          <span className={styles.verdict} data-verdict={item.verdict}>
            {VERDICT_LABELS[item.verdict]}
          </span>
        </li>
      ))}
    </ul>
  )
}
