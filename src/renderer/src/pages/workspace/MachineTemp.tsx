import styles from './MachineTemp.module.css'

const TICKS = 72
const START_ANGLE = -150
const SWEEP = 300
const INNER_RADIUS = 70
const OUTER_RADIUS = 92
const MIN_C = 16
const MAX_C = 30
const COOL = [111, 140, 255]
const WARM = [255, 180, 84]
const SAMPLE_READING_C = 22

const FILLED = Math.round(((SAMPLE_READING_C - MIN_C) / (MAX_C - MIN_C)) * TICKS)

function tickColor(index: number): string {
  if (index >= FILLED) return 'rgb(255 255 255 / 0.12)'
  const mix = index / Math.max(1, FILLED - 1)
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
    y2: 100 + cos * OUTER_RADIUS,
    color: tickColor(index)
  }
})

export default function MachineTemp() {
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
            stroke={tick.color}
            style={{ animationDelay: `${index * 14}ms` }}
          />
        ))}
      </svg>
      <p className={styles.value}>
        {SAMPLE_READING_C}
        <span className={styles.unit}>°C</span>
      </p>
    </div>
  )
}
