import { useId, type ReactNode } from 'react'
import styles from './Widget.module.css'

interface WidgetProps {
  area: string
  title: string
  revealed: boolean
  icon?: ReactNode
  meta?: ReactNode
  accent?: boolean
  children: ReactNode
}

export default function Widget({
  area,
  title,
  revealed,
  icon,
  meta,
  accent,
  children
}: WidgetProps) {
  const titleId = useId()

  return (
    <section
      className={styles.widget}
      aria-labelledby={titleId}
      data-widget={area}
      data-accent={accent || undefined}
      style={{ gridArea: area }}
    >
      <header className={styles.header}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {meta && <div className={styles.meta}>{meta}</div>}
      </header>
      <div className={styles.body}>{revealed && children}</div>
    </section>
  )
}
