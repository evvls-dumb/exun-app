import { useLayoutEffect, useRef, type RefObject } from 'react'
import styles from './DotField.module.css'

const CELL = 14
const PIXEL = CELL - 3
const IDLE_DOT = 2
const SWEEP_MS = 1500
const START_DELAY_MS = 120
const JITTER_MS = 110
const LEAD_MS = 240
const DECAY_MS = 460
const FLASH_MS = 90
const FLASH_SHARE = 0.3
const IDLE_ALPHA = 0.15
const IDLE_FADE_MS = 160
const ORIGIN_INSET = -60
const CARD_RADIUS = 22
const WARM_SHARE = 0.025

interface Cell {
  x: number
  y: number
  reveal: number
  inside: boolean
  warm: boolean
  sparkle: boolean
}

interface Card {
  id: string
  reach: number
}

interface Box {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

interface DotFieldProps {
  stage: RefObject<HTMLElement | null>
  onReach: (id: string) => void
  onDone: () => void
}

function hash(x: number, y: number, salt: number): number {
  const value = ((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0
  return (value % 1000) / 1000
}

function easeOut(progress: number): number {
  return 1 - (1 - progress) ** 3
}

function sweepTime(share: number): number {
  return Math.acos(1 - 2 * Math.min(1, Math.max(0, share))) / Math.PI
}

function insideRounded(x: number, y: number, box: Box): boolean {
  const cornerX = Math.min(Math.max(x, box.left + CARD_RADIUS), box.right - CARD_RADIUS)
  const cornerY = Math.min(Math.max(y, box.top + CARD_RADIUS), box.bottom - CARD_RADIUS)
  return (
    x >= box.left &&
    x <= box.right &&
    y >= box.top &&
    y <= box.bottom &&
    Math.hypot(x - cornerX, y - cornerY) <= CARD_RADIUS
  )
}

export default function DotField({ stage, onReach, onDone }: DotFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const stageElement = stage.current
    if (!canvas || !context || !stageElement) {
      onDone()
      return
    }

    const tokens = getComputedStyle(canvas)
    const accent = tokens.getPropertyValue('--color-accent-bright').trim()
    const warm = tokens.getPropertyValue('--color-warn').trim()
    const flash = tokens.getPropertyValue('--color-text').trim()
    const cover = tokens.getPropertyValue('--color-frame').trim()

    let width = 0
    let height = 0
    let cells: Cell[] = []
    let cards: Card[] = []
    let end = 0

    function layout() {
      if (!canvas || !context || !stageElement) return
      const ratio = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      const frame = canvas.getBoundingClientRect()
      const area = stageElement.getBoundingClientRect()
      const left = area.left - frame.left
      const top = area.top - frame.top
      const right = Math.min(area.right - frame.left, width)
      const bottom = Math.min(area.bottom - frame.top, height)
      const originX = left + ORIGIN_INSET
      const originY = top + ORIGIN_INSET
      const sweep = Math.hypot(right - originX, bottom - originY)
      const arrival = (x: number, y: number) =>
        START_DELAY_MS + SWEEP_MS * sweepTime(Math.hypot(x - originX, y - originY) / sweep)

      const boxes: Box[] = [...stageElement.querySelectorAll<HTMLElement>('[data-widget]')].map(
        (element) => {
          const rect = element.getBoundingClientRect()
          return {
            id: element.dataset.widget ?? '',
            left: rect.left - frame.left,
            top: rect.top - frame.top,
            right: rect.right - frame.left,
            bottom: rect.bottom - frame.top
          }
        }
      )

      cells = []
      for (let y = top, row = 0; y < bottom; y += CELL, row += 1) {
        for (let x = left, column = 0; x < right; x += CELL, column += 1) {
          const box = boxes.find(
            (candidate) =>
              x < candidate.right &&
              x + CELL > candidate.left &&
              y < candidate.bottom &&
              y + CELL > candidate.top
          )
          if (!box) continue
          const centerX = x + CELL / 2
          const centerY = y + CELL / 2
          cells.push({
            x,
            y,
            reveal: arrival(centerX, centerY) + hash(column, row, 1) * JITTER_MS,
            inside: insideRounded(centerX, centerY, box),
            warm: hash(column, row, 2) < WARM_SHARE,
            sparkle: hash(column, row, 3) < FLASH_SHARE
          })
        }
      }

      cards = boxes
        .map((box) => ({
          id: box.id,
          reach: arrival(
            Math.min(Math.max(originX, box.left), box.right),
            Math.min(Math.max(originY, box.top), box.bottom)
          )
        }))
        .sort((a, b) => a.reach - b.reach)

      end =
        Math.max(0, ...cells.map((cell) => cell.reveal), ...cards.map((card) => card.reach)) +
        DECAY_MS
    }

    function draw(elapsed: number) {
      if (!context) return
      context.clearRect(0, 0, width, height)

      context.globalAlpha = 1
      context.fillStyle = cover
      for (const cell of cells) {
        if (elapsed < cell.reveal) context.fillRect(cell.x, cell.y, CELL + 1, CELL + 1)
      }

      const idle = Math.min(1, elapsed / IDLE_FADE_MS) * IDLE_ALPHA
      for (const cell of cells) {
        if (!cell.inside) continue
        const local = elapsed - cell.reveal
        if (local >= DECAY_MS) continue

        let size: number
        let alpha: number
        let color = cell.warm ? warm : accent

        if (local < -LEAD_MS) {
          size = IDLE_DOT
          alpha = idle
          color = accent
        } else if (local < 0) {
          const charge = 1 + local / LEAD_MS
          size = IDLE_DOT + (PIXEL - IDLE_DOT) * charge * charge
          alpha = 0.15 + 0.75 * charge
        } else {
          const fade = easeOut(local / DECAY_MS)
          size = PIXEL * (1 - fade)
          alpha = 0.9 * (1 - fade)
          if (cell.sparkle && local < FLASH_MS) color = flash
        }

        const rounded = Math.max(1, Math.round(size))
        const offset = Math.round((CELL - rounded) / 2)
        context.globalAlpha = alpha
        context.fillStyle = color
        context.fillRect(cell.x + offset, cell.y + offset, rounded, rounded)
      }
      context.globalAlpha = 1
    }

    layout()
    draw(0)

    const start = performance.now()
    let frame = 0

    function tick(now: number) {
      const elapsed = now - start
      while (cards.length > 0 && (elapsed >= cards[0].reach - LEAD_MS || elapsed >= end)) {
        onReach(cards[0].id)
        cards.shift()
      }
      if (elapsed >= end) {
        onDone()
        return
      }
      draw(elapsed)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    function handleResize() {
      layout()
      draw(performance.now() - start)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleResize)
    }
  }, [stage, onReach, onDone])

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
}
