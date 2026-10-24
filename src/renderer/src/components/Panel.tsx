import { useId, type ReactNode } from 'react'
import styles from './Panel.module.css'

interface PanelProps {
  title: string
  as?: 'h1' | 'h2'
  icon?: ReactNode
  className?: string
  children: ReactNode
}

export default function Panel({ title, as: Heading = 'h2', icon, className, children }: PanelProps) {
  const titleId = useId()
  const classes = [styles.panel, className].filter(Boolean).join(' ')

  return (
    <section className={classes} aria-labelledby={titleId}>
      <header className={styles.header}>
        {icon}
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  )
}
