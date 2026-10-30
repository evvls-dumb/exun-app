import styles from './Auth.module.css'

export const STEPS = ['Callsign', 'Passphrase', 'Keyfile', 'Review', 'Recovery'] as const

/** Five dots on a line. The line fills as setup goes on. `busy` marks the current step as still working. */
export default function Stepper({ current, busy = false }: { current: number; busy?: boolean }) {
  const fill = current * 20 - (busy ? 10 : 0)
  return (
    <nav aria-label="Setup progress" className={styles.stepper}>
      <div className={styles.stepsWrap}>
        <div className={styles.track} aria-hidden="true" />
        <div className={styles.fill} style={{ width: `${fill}%` }} aria-hidden="true" />
        <ol className={styles.list}>
          {STEPS.map((name, i) => {
            const state = i < current ? 'done' : i === current ? (busy ? 'busy' : 'current') : 'todo'
            return (
              <li key={name} className={styles.step} aria-current={i === current ? 'step' : undefined}>
                <span className={styles.dot} data-state={state} />
                <span className={styles.stepLabel} data-state={state}>
                  {name}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}
