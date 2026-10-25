import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/lib/motion'
import styles from './AmbientField.module.css'

const CELL = 16
const FRAME_MS = 1000 / 30
const FADE_MS = 900
const BASE_ALPHA = 0.035
const GLOW_ALPHA = 0.42
const MIN_ALPHA = 0.03
const COVER_SELECTOR = '[data-widget]'
const FADE_SELECTOR = '[data-ambient-fade]'
const FADE_PX = 44

const LIGHTS = [
  { x: 0.5, y: 0.4, ax: 0.42, ay: 0.3, fx: 0.11, fy: 0.07, phase: 0, radius: 0.3 },
  { x: 0.55, y: 0.6, ax: 0.38, ay: 0.34, fx: 0.07, fy: 0.13, phase: 2.4, radius: 0.26 },
  { x: 0.5, y: 0.5, ax: 0.45, ay: 0.4, fx: 0.05, fy: 0.09, phase: 4.1, radius: 0.22 }
] as const

interface Dot {
  x: number
  y: number
  twinkle: number
  fade: number
}

interface Capsule {
  cx: number
  cy: number
  halfWidth: number
  halfHeight: number
  radius: number
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

function capsuleDistance(x: number, y: number, capsule: Capsule): number {
  const qx = Math.abs(x - capsule.cx) - (capsule.halfWidth - capsule.radius)
  const qy = Math.abs(y - capsule.cy) - (capsule.halfHeight - capsule.radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - capsule.radius
}

function hash(x: number, y: number): number {
  const value = ((x * 73856093) ^ (y * 19349663)) >>> 0
  return (value % 1000) / 1000
}

export default function AmbientField({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  const hiddenSince = useRef(active ? Infinity : 0)
  const refresh = useRef<() => void>(() => undefined)

  useEffect(() => {
    activeRef.current = active
    if (active) {
      hiddenSince.current = Infinity
      refresh.current()
    } else {
      hiddenSince.current = performance.now()
    }
  }, [active])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const frameElement = canvas?.parentElement?.parentElement
    if (!canvas || !context || !frameElement) return

    const accent = getComputedStyle(canvas).getPropertyValue('--color-accent-bright').trim()
    const reduced = prefersReducedMotion()

    let width = 0
    let height = 0
    let dots: Dot[] = []

    function layout() {
      if (!canvas || !context || !frameElement) return
      const ratio = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      const origin = canvas.getBoundingClientRect()
      const covers = [...frameElement.querySelectorAll<HTMLElement>(COVER_SELECTOR)].map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          right: rect.right - origin.left,
          bottom: rect.bottom - origin.top
        }
      })
      const capsules: Capsule[] = [...frameElement.querySelectorAll<HTMLElement>(FADE_SELECTOR)].map(
        (element) => {
          const rect = element.getBoundingClientRect()
          const halfWidth = rect.width / 2
          const halfHeight = rect.height / 2
          return {
            cx: rect.left - origin.left + halfWidth,
            cy: rect.top - origin.top + halfHeight,
            halfWidth,
            halfHeight,
            radius: Math.min(halfWidth, halfHeight)
          }
        }
      )

      dots = []
      for (let row = 0; row * CELL < height; row += 1) {
        for (let column = 0; column * CELL < width; column += 1) {
          const x = column * CELL + CELL / 2
          const y = row * CELL + CELL / 2
          const hidden = covers.some(
            (box) => x > box.left - 2 && x < box.right + 2 && y > box.top - 2 && y < box.bottom + 2
          )
          if (hidden) continue

          const fade = capsules.reduce(
            (least, capsule) => Math.min(least, smoothstep(capsuleDistance(x, y, capsule) / FADE_PX)),
            1
          )
          if (fade < 0.02) continue
          dots.push({ x, y, twinkle: hash(column, row) * Math.PI * 2, fade })
        }
      }
    }

    function draw(seconds: number) {
      if (!context) return
      context.clearRect(0, 0, width, height)
      const reach = Math.max(width, height)

      const lights = LIGHTS.map((light) => ({
        x: (light.x + light.ax * Math.sin(seconds * light.fx + light.phase)) * width,
        y: (light.y + light.ay * Math.cos(seconds * light.fy + light.phase)) * height,
        spread: 2 * (light.radius * reach) ** 2
      }))

      context.fillStyle = accent
      for (const dot of dots) {
        let glow = 0
        for (const light of lights) {
          const dx = dot.x - light.x
          const dy = dot.y - light.y
          glow += Math.exp(-(dx * dx + dy * dy) / light.spread)
        }
        glow = Math.min(1, glow)

        const shimmer = 0.85 + 0.15 * Math.sin(seconds * 0.9 + dot.twinkle)
        const alpha = (BASE_ALPHA + GLOW_ALPHA * glow) * shimmer * dot.fade
        if (alpha < MIN_ALPHA * dot.fade) continue

        const size = glow > 0.55 && dot.fade > 0.6 ? 3 : 2
        context.globalAlpha = alpha
        context.fillRect(Math.round(dot.x - size / 2), Math.round(dot.y - size / 2), size, size)
      }
      context.globalAlpha = 1
    }

    layout()
    draw(reduced ? 12 : 0)
    refresh.current = () => {
      layout()
      draw(reduced ? 12 : performance.now() / 1000)
    }

    const observer = new ResizeObserver(() => {
      layout()
      draw(reduced ? 12 : performance.now() / 1000)
    })
    observer.observe(frameElement)

    let frame = 0
    if (!reduced) {
      const start = performance.now()
      let last = 0
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick)
        if (now - last < FRAME_MS) return
        if (!activeRef.current && now - hiddenSince.current > FADE_MS) return
        last = now
        draw((now - start) / 1000)
      }
      frame = requestAnimationFrame(tick)
    }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div className={styles.layer} data-active={active || undefined} aria-hidden="true">
      <span className={`${styles.glow} ${styles.glowA}`} />
      <span className={`${styles.glow} ${styles.glowB}`} />
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  )
}
