import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const SPIN_PER_SECOND = 0.7
const PERSPECTIVE = 3.2
const LIGHT = normalize([-0.45, -0.6, 0.66])
const SHADE: RGB = [74, 58, 160]
const LIT: RGB = [178, 164, 255]
const GLINT: RGB = [255, 255, 255]

type RGB = [number, number, number]

function normalize([x, y, z]: RGB): RGB {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
}

interface DotSphereProps {
  size?: number
  className?: string
}

export default function DotSphere({ size = 32, className }: DotSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(size * ratio)
    canvas.height = Math.round(size * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    const count = Math.round(size * 4)
    const points = Array.from({ length: count }, (_, index) => {
      const y = 1 - (index / (count - 1)) * 2
      const radius = Math.sqrt(1 - y * y)
      const angle = GOLDEN_ANGLE * index
      return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius }
    })
    const projected = points.map(() => ({ x: 0, y: 0, z: 0, r: 0, alpha: 0, colour: '' }))

    const centre = size / 2
    const sphereRadius = size * 0.4
    const dotScale = size / 40

    function draw(seconds: number) {
      if (!context) return
      context.clearRect(0, 0, size, size)
      const spin = seconds * SPIN_PER_SECOND
      const tilt = 0.35 + 0.15 * Math.sin(seconds * 0.5)
      const [sinSpin, cosSpin] = [Math.sin(spin), Math.cos(spin)]
      const [sinTilt, cosTilt] = [Math.sin(tilt), Math.cos(tilt)]
      const breathe = 1 + 0.03 * Math.sin(seconds * 2)
      const band = Math.sin(seconds * 1.7) * 0.9

      points.forEach((point, index) => {
        const x1 = point.x * cosSpin + point.z * sinSpin
        const z1 = point.z * cosSpin - point.x * sinSpin
        const y2 = point.y * cosTilt - z1 * sinTilt
        const z2 = point.y * sinTilt + z1 * cosTilt
        const depth = (z2 + 1) / 2
        const light = Math.max(0, x1 * LIGHT[0] + y2 * LIGHT[1] + z2 * LIGHT[2])
        const glint = Math.exp(-((y2 - band) ** 2) / 0.02) * depth
        const scale = (PERSPECTIVE / (PERSPECTIVE - z2)) * breathe
        const [r, g, b] = mix(mix(SHADE, LIT, light ** 0.8), GLINT, glint * 0.85)

        const out = projected[index]
        out.x = centre + x1 * sphereRadius * scale
        out.y = centre + y2 * sphereRadius * scale
        out.z = z2
        out.r = (0.45 + depth * 0.75 + glint * 0.45) * dotScale
        out.alpha = Math.min(1, 0.1 + 0.9 * depth ** 1.7 + glint * 0.4)
        out.colour = `rgb(${r | 0} ${g | 0} ${b | 0})`
      })

      projected.sort((a, b) => a.z - b.z)
      for (const dot of projected) {
        context.globalAlpha = dot.alpha
        context.fillStyle = dot.colour
        context.beginPath()
        context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
    }

    if (prefersReducedMotion()) {
      draw(0.8)
      return
    }

    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      draw((now - start) / 1000)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
