import { useMemo, useRef } from 'react'
import { ResponsiveLine, type LineCustomSvgLayer } from '@nivo/line'
import type { Analysis } from '@shared/meter'
import { formatLongDate, formatNumber, formatSigned } from '@/lib/format'
import { prefersReducedMotion } from '@/lib/motion'
import ChartTip, { type TipTone } from './ChartTip'
import { useFloatingTip } from './FloatingTip'
import { chartTheme, readPalette, type Palette } from './palette'
import styles from './NivoCharts.module.css'

type Series = { id: string; data: { x: string; y: number }[] }

function dayLabel(date: string): string {
  return String(Number(date.slice(8)))
}

function readingTip(analysis: Analysis, index: number) {
  const day = analysis.days[index]
  const previous = analysis.days[index - 1]
  const projected = analysis.projected[index]
  const rows: { label: string; value: string; tone?: 'critical' | 'warning' }[] = [
    { label: 'Reading', value: `${formatNumber(day.reading)} kWh` }
  ]
  if (previous && day.delta !== null) {
    rows.push({ label: 'Previous', value: `${formatNumber(previous.reading)} kWh` })
    rows.push({
      label: 'Change',
      value: `${formatSigned(day.delta)} kWh`,
      tone: day.spike ? 'critical' : undefined
    })
  }
  rows.push({
    label: 'Logged usage',
    value: `${formatNumber(day.usage)} kWh`,
    tone: day.mismatch ? 'warning' : undefined
  })
  if (day.mismatch && day.delta !== null) {
    rows.push({ label: 'Difference', value: `${formatSigned(day.usage - day.delta)} kWh`, tone: 'warning' })
  }
  if (projected !== null && index > 0) {
    rows.push({ label: 'Projected (est.)', value: `${formatNumber(projected)} kWh` })
  }

  const tone: TipTone = day.spike ? 'critical' : day.mismatch ? 'warning' : day.future ? 'info' : 'neutral'
  const label = day.spike ? 'Spike' : day.mismatch ? 'Mismatch' : day.future ? 'Future-dated' : 'Normal'
  return <ChartTip title={formatLongDate(day.date)} rows={rows} status={{ label, tone }} />
}

interface LayerContext {
  analysis: Analysis
  palette: Palette
}

function projectionLayer({ analysis, palette }: LayerContext): LineCustomSvgLayer<Series> {
  return function Projection({ xScale, yScale }) {
    const path = analysis.days
      .flatMap((day, index) => {
        const projected = analysis.projected[index]
        return projected === null ? [] : [`${xScale(dayLabel(day.date))} ${yScale(projected)}`]
      })
      .join(' L ')

    return (
      <path
        className={styles.reveal}
        d={`M ${path}`}
        fill="none"
        stroke={palette.muted}
        strokeOpacity={0.7}
        strokeWidth={1.25}
        strokeDasharray="5 4"
      />
    )
  }
}

function jumpLayer({ analysis, palette }: LayerContext): LineCustomSvgLayer<Series> {
  return function Jump({ xScale, yScale }) {
    return (
      <g className={styles.reveal}>
        {analysis.days.map((day, index) => {
          const previous = analysis.days[index - 1]
          if (!day.spike || !previous) return null
          return (
            <line
              key={day.date}
              x1={xScale(dayLabel(previous.date))}
              y1={yScale(previous.reading)}
              x2={xScale(dayLabel(day.date))}
              y2={yScale(day.reading)}
              stroke={palette.danger}
              strokeWidth={2.25}
              strokeLinecap="round"
            />
          )
        })}
      </g>
    )
  }
}

interface ReadingLineProps {
  analysis: Analysis
}

export default function ReadingLine({ analysis }: ReadingLineProps) {
  const palette = useMemo(readPalette, [])
  const theme = useMemo(() => chartTheme(palette), [palette])
  const animate = useMemo(() => !prefersReducedMotion(), [])
  const tip = useFloatingTip()
  const hovered = useRef<string | null>(null)

  const data = useMemo<Series[]>(
    () => [
      {
        id: 'Reading',
        data: analysis.days.map((day) => ({ x: dayLabel(day.date), y: day.reading }))
      }
    ],
    [analysis]
  )

  const dayByLabel = useMemo(
    () => new Map(analysis.days.map((day, index) => [dayLabel(day.date), { day, index }])),
    [analysis]
  )

  const showReading = (label: unknown, pointer: { clientX: number; clientY: number }) => {
    const entry = dayByLabel.get(String(label))
    if (entry) tip.show(readingTip(analysis, entry.index), pointer)
  }

  const layers = useMemo(() => {
    const context = { analysis, palette }
    return [
      'grid',
      'axes',
      'crosshair',
      projectionLayer(context),
      'lines',
      jumpLayer(context),
      'points',
      'mesh'
    ] as const
  }, [analysis, palette])

  return (
    <div
      className={styles.frame}
      role="img"
      aria-label="Cumulative meter reading, with the baseline projection dashed"
    >
      <div className={styles.canvas}>
        <ResponsiveLine<Series>
          data={data}
          layers={layers}
          margin={{ top: 12, right: 12, bottom: 24, left: 46 }}
          xScale={{ type: 'point' }}
          yScale={{ type: 'linear', min: 'auto', max: 'auto', nice: true }}
          curve="linear"
          colors={[palette.accent]}
          lineWidth={2}
          enablePoints
          pointSize={5}
          pointSymbol={({ size, datum }) => {
            const entry = dayByLabel.get(String(datum.x))
            return (
              <circle
                r={size / 2}
                fill={entry?.day.spike ? palette.danger : palette.accent}
                stroke={palette.card}
                strokeWidth={1}
              />
            )
          }}
          enableGridX={false}
          gridYValues={4}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: 4,
            format: (value) => `${formatNumber(Number(value) / 1000)}k`
          }}
          axisBottom={{ tickSize: 0, tickPadding: 8 }}
          useMesh
          enableCrosshair
          crosshairType="x"
          tooltip={() => <span />}
          onMouseEnter={(target, event) => {
            if (!('data' in target)) return
            hovered.current = target.id
            showReading(target.data.x, event)
          }}
          onMouseMove={(target, event) => {
            if (!('data' in target)) return
            hovered.current = target.id
            showReading(target.data.x, event)
          }}
          onMouseLeave={(target) => {
            if ('data' in target && hovered.current !== target.id) return
            hovered.current = null
            tip.hide()
          }}
          theme={theme}
          animate={animate}
          motionConfig="gentle"
        />
      </div>
      {tip.element}
    </div>
  )
}
