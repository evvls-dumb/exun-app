import { formatNumber } from '@/lib/format'
import styles from './MachineTemp.module.css'

const TICKS = 72
const START_ANGLE = -150
const SWEEP = 300
const INNER_RADIUS = 77
const OUTER_RADIUS = 95
const MIN_C = 20
const MAX_C = 80
const COOL = [111, 140, 255]
const WARM = [255, 180, 84]

function tickColor(index: number, filled: number): string {
  if (index >= filled) return 'rgb(255 255 255 / 0.12)'
  const mix = index / Math.max(1, filled - 1)
  const [red, green, blue] = COOL.map((from, channel) =>
    Math.round(from + (WARM[channel] - from) * mix)
  )
  return `rgb(${red} ${green} ${blue})`
}

const DIAL = Array.from({ length: TICKS }, (_, index) => {
  const angle = ((START_ANGLE + (SWEEP * index) / (TICKS - 1)) * Math.PI) / 180
  const sin = Math.sin(angle)
  const cos = -Math.cos(angle)
  return {
    x1: 100 + sin * INNER_RADIUS,
    y1: 100 + cos * INNER_RADIUS,
    x2: 100 + sin * OUTER_RADIUS,
    y2: 100 + cos * OUTER_RADIUS
  }
})

interface MachineTempProps {
  celsius: number | null
}

export default function MachineTemp({ celsius }: MachineTempProps) {
  const share = celsius === null ? 0 : (Math.min(Math.max(celsius, MIN_C), MAX_C) - MIN_C) / (MAX_C - MIN_C)
  const filled = Math.round(share * TICKS)

  return (
    <div className={styles.dial}>
      <svg className={styles.ticks} viewBox="0 0 200 200" aria-hidden="true">
        {DIAL.map((tick, index) => (
          <line
            key={index}
            className={styles.tick}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tickColor(index, filled)}
            style={{ animationDelay: `${index * 14}ms` }}
          />
        ))}
      </svg>
      <p className={styles.value}>
        {celsius === null ? '—' : formatNumber(celsius)}
        <span className={styles.unit}>°C</span>
      </p>
    </div>
  )
}
