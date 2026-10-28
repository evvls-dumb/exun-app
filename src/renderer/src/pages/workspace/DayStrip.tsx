import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Tone } from '@shared/meter'
import styles from './Summary.module.css'

const CARET_INSET_PX = 16

export type StripTone = Tone | 'missing'

export interface StripDay {
  key: string
  tone: StripTone
  date: string
  value: string
  status: string
}

interface DayStripProps {
  days: readonly StripDay[]
  label: string
}

export default function DayStrip({ days, label }: DayStripProps) {
  const [shown, setShown] = useState(0)
  const [visible, setVisible] = useState(false)
  const [instant, setInstant] = useState(true)
  const [tip, setTip] = useState({ x: 0, caret: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])

  function showTip(index: number) {
    if (!visible) setInstant(true)
    setShown(index)
    setVisible(true)
  }

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const pill = tipRef.current
    const item = itemRefs.current[shown]
    if (!visible || !wrap || !pill || !item) return

    const centre = item.offsetLeft + item.offsetWidth / 2
    const x = Math.min(Math.max(centre - pill.offsetWidth / 2, 0), wrap.clientWidth - pill.offsetWidth)
    const caret = Math.min(
      Math.max(centre - x, CARET_INSET_PX),
      pill.offsetWidth - CARET_INSET_PX
    )
    setTip({ x, caret })

    if (!instant) return
    const frame = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(frame)
  }, [shown, visible, instant])

  const shownDay = days[shown]
  if (!shownDay) return null

  return (
    <div ref={wrapRef} className={styles.stripWrap}>
      <ul className={styles.strip} aria-label={label} onPointerLeave={() => setVisible(false)}>
        {days.map((day, index) => (
          <li
            key={day.key}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            className={styles.day}
            data-tone={day.tone}
            data-active={(visible && shown === index) || undefined}
            style={{ animationDelay: `${index * 28}ms` }}
            onPointerEnter={() => showTip(index)}
          >
            <span className="sr-only">
              {day.date}: {day.value}, {day.status}
            </span>
          </li>
        ))}
      </ul>

      <div
        ref={tipRef}
        className={styles.tip}
        data-tone={shownDay.tone}
        data-visible={visible || undefined}
        data-instant={instant || undefined}
        style={{ '--x': `${tip.x}px`, '--caret': `${tip.caret}px` } as CSSProperties}
        aria-hidden="true"
      >
        <span className={styles.tipDot} />
        <span className={styles.tipDate}>{shownDay.date}</span>
        <span className={styles.tipValue}>{shownDay.value}</span>
        <span className={styles.tipStatus}>{shownDay.status}</span>
      </div>
    </div>
  )
}
