import type { CSSProperties } from 'react'
import styles from './LumaSpin.module.css'

const DEFAULT_SIZE = 65

interface LumaSpinProps {
  size?: number
}

export default function LumaSpin({ size = DEFAULT_SIZE }: LumaSpinProps) {
  return (
    <div
      className={styles.spin}
      style={{ '--size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className={styles.ring} />
      <span className={`${styles.ring} ${styles.delayed}`} />
    </div>
  )
}
