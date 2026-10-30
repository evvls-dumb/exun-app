import { createContext, useContext, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { ResponsiveBar, type BarCustomLayer } from '@nivo/bar'
import type { Analysis, DayRecord } from '@shared/meter'
import { formatLongDate, formatNumber, formatShortDate, formatSigned } from '@/lib/format'
import { prefersReducedMotion } from '@/lib/motion'
import ChartTip, { type TipTone } from './ChartTip'
import { useFloatingTip } from './FloatingTip'
import { chartTheme, readPalette, withAlpha, type Palette } from './palette'
import styles from './NivoCharts.module.css'

export const USAGE_CAP_KWH = 45

const BREAK_KWH = 2
/** Axis height given to everything above the cap, on a log scale, so a 500 kWh day and a 2,700 kWh day
 *  still differ in height instead of both being cut at the same line. */
const LOG_SPAN_KWH = 30
const DIMMED_ALPHA = 0.38
const MARGIN = { top: 18, right: 10, bottom: 36, left: 34 }
const VALUE_PILL = { width: 50, height: 22, gap: 4 }
const DAY_PILL = { width: 58, height: 22 }

type Datum = { day: string; value: number }
type Scale = (value: number) => number

const ActiveContext = createContext<number | null>(null)

export function isCapped(day: DayRecord): boolean {
  return day.usage > USAGE_CAP_KWH
}

/** Height on the axis for a value: linear up to the cap, then compressed logarithmically above it. */
export function plotValue(value: number): number {
  return value <= USAGE_CAP_KWH ? value : USAGE_CAP_KWH + LOG_SPAN_KWH * Math.log10(value / USAGE_CAP_KWH)
}

function status(day: DayRecord): { label: string; tone: TipTone } {
  if (day.spike) return { label: 'Spike', tone: 'critical' }
  if (day.mismatch) return { label: 'Mismatch', tone: 'warning' }
  if (day.future) return { label: 'Future-dated', tone: 'info' }
  if (day.delta === null) return { label: 'No prior reading', tone: 'neutral' }
  return { label: 'Normal', tone: 'neutral' }
}

function barColor(day: DayRecord, palette: Palette): string {
  if (day.spike) return palette.danger
  if (day.mismatch) return palette.warn
  return palette.accent
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function usageTip(day: DayRecord, baseline: number) {
  const used = day.delta ?? day.usage
  const deviation = ((used - baseline) / baseline) * 100
  return (
    <ChartTip
      title={formatLongDate(day.date)}
      rows={[
        { label: 'Logged', value: `${formatNumber(day.usage)} kWh`, tone: day.mismatch ? 'warning' : undefined },
        {
          label: 'Meter-derived',
          value: day.delta === null ? 'No prior reading' : `${formatNumber(day.delta)} kWh`
        },
        {
          label: 'vs baseline',
          value: `${formatSigned(deviation, 0)}%`,
          tone: day.spike ? 'critical' : undefined
        }
      ]}
      status={status(day)}
      note={isCapped(day) ? `Above ${USAGE_CAP_KWH} kWh the bar is drawn on a compressed scale so normal days stay readable. Taller still means more, but not in proportion.` : undefined}
    />
  )
}

interface PillProps {
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
  palette: Palette
}

function Pill({ x, y, width, height, text, color, palette }: PillProps) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={width} height={height} rx={height / 2} fill={palette.raised} stroke={color} strokeOpacity={0.7} />
      <text
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={palette.text}
        fontSize={11}
        fontWeight={600}
        fontFamily={palette.mono}
      >
        {text}
      </text>
    </g>
  )
}

interface LayerContext {
  analysis: Analysis
  palette: Palette
  onActive: (index: number | null) => void
  showTip: (content: ReactNode, pointer: { clientX: number; clientY: number }) => void
  hideTip: () => void
}

function floorLayer({ palette }: LayerContext): BarCustomLayer<Datum> {
  return function Floor({ innerWidth, innerHeight }) {
    return <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} stroke={palette.border} />
  }
}

function guideLinesLayer({ analysis, palette }: LayerContext): BarCustomLayer<Datum> {
  return function GuideLines({ bars, yScale }) {
    const active = useContext(ActiveContext)
    const bar = active === null ? undefined : bars.find((candidate) => candidate.data.index === active)
    if (!bar || active === null) return null

    const day = analysis.days[active]
    const y = (yScale as unknown as Scale)(plotValue(day.usage))
    return (
      <line
        className={styles.pop}
        x1={0}
        x2={bar.x}
        y1={y}
        y2={y}
        stroke={barColor(day, palette)}
        strokeOpacity={0.7}
        strokeDasharray="3 4"
        pointerEvents="none"
      />
    )
  }
}

function guidePillsLayer({ analysis, palette }: LayerContext): BarCustomLayer<Datum> {
  return function GuidePills({ bars, yScale, innerWidth, innerHeight, margin }) {
    const active = useContext(ActiveContext)
    const bar = active === null ? undefined : bars.find((candidate) => candidate.data.index === active)
    if (!bar || active === null) return null

    const day = analysis.days[active]
    const color = barColor(day, palette)
    const y = (yScale as unknown as Scale)(plotValue(day.usage))
    const centre = bar.x + bar.width / 2
    const dayX = clamp(
      centre - DAY_PILL.width / 2,
      -margin.left + 4,
      innerWidth + margin.right - DAY_PILL.width - 4
    )

    return (
      <g className={styles.pop} pointerEvents="none">
        <Pill
          x={-VALUE_PILL.width - VALUE_PILL.gap}
          y={y - VALUE_PILL.height / 2}
          width={VALUE_PILL.width}
          height={VALUE_PILL.height}
          text={formatNumber(day.usage)}
          color={color}
          palette={palette}
        />
        <Pill
          x={dayX}
          y={innerHeight + 9}
          width={DAY_PILL.width}
          height={DAY_PILL.height}
          text={formatShortDate(day.date)}
          color={color}
          palette={palette}
        />
      </g>
    )
  }
}

function baselineLayer({ analysis, palette }: LayerContext): BarCustomLayer<Datum> {
  return function Baseline({ yScale, innerWidth }) {
    const y = (yScale as unknown as Scale)(analysis.baseline)
    return (
      <g className={styles.reveal} pointerEvents="none">
        <line x1={0} x2={innerWidth} y1={y} y2={y} stroke={palette.muted} strokeDasharray="4 4" opacity={0.7} />
        <text x={6} y={y - 5} fill={palette.muted} fontSize={10} fontFamily={palette.mono}>
          baseline {formatNumber(analysis.baseline)}
        </text>
      </g>
    )
  }
}

function meterLayer({ analysis, palette }: LayerContext): BarCustomLayer<Datum> {
  return function MeterDerived({ bars, yScale }) {
    const y = yScale as unknown as Scale
    // One dot per day, joined by a line. A day that runs off the linear scale gets its dot at the top of its bar.
    const points = bars.flatMap((bar) => {
      const day = analysis.days[bar.data.index]
      if (day.delta === null) return []
      return [{ x: bar.x + bar.width / 2, y: y(plotValue(isCapped(day) ? day.usage : day.delta)) }]
    })

    return (
      <g className={styles.reveal} pointerEvents="none">
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke={palette.text}
          strokeOpacity={0.35}
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <circle key={point.x} cx={point.x} cy={point.y} r={3.5} fill={palette.text} stroke={palette.card} strokeWidth={1.5} />
        ))}
      </g>
    )
  }
}

function cutLayer({ analysis, palette }: LayerContext): BarCustomLayer<Datum> {
  return function Cuts({ bars, yScale }) {
    const y = yScale as unknown as Scale
    const top = y(USAGE_CAP_KWH)
    const bottom = y(USAGE_CAP_KWH - BREAK_KWH)

    return (
      <g className={styles.reveal} pointerEvents="none">
        {bars.map((bar) => {
          const day = analysis.days[bar.data.index]
          if (!isCapped(day)) return null
          const base = bar.y + bar.height
          return (
            <g key={bar.key}>
              <rect x={bar.x - 1} y={top} width={bar.width + 2} height={bottom - top} fill={palette.card} />
              <text
                transform={`translate(${bar.x + bar.width / 2} ${(bottom + base) / 2}) rotate(-90)`}
                textAnchor="middle"
                dominantBaseline="central"
                fill={palette.ink}
                fontSize={11}
                fontWeight={700}
                fontFamily={palette.mono}
              >
                {formatNumber(day.usage)}
              </text>
            </g>
          )
        })}
      </g>
    )
  }
}

function hoverLayer({ analysis, onActive, showTip, hideTip }: LayerContext): BarCustomLayer<Datum> {
  return function Hover({ bars, innerHeight }) {
    const active = useContext(ActiveContext)
    const step = bars.length > 1 ? bars[1].x - bars[0].x : (bars[0]?.width ?? 0)

    return (
      <g>
        {bars.map((bar) => {
          const index = bar.data.index
          const enter = (event: MouseEvent) => {
            onActive(index)
            showTip(usageTip(analysis.days[index], analysis.baseline), event)
          }
          return (
            <rect
              key={bar.key}
              className={styles.hit}
              x={bar.x + bar.width / 2 - step / 2}
              y={0}
              width={step}
              height={innerHeight}
              rx={6}
              fill={active === index ? 'rgba(255, 255, 255, 0.04)' : 'transparent'}
              onMouseEnter={enter}
              onMouseMove={enter}
              onMouseLeave={() => {
                onActive(null)
                hideTip()
              }}
            />
          )
        })}
      </g>
    )
  }
}

interface UsageBarsProps {
  analysis: Analysis
}

export default function UsageBars({ analysis }: UsageBarsProps) {
  const palette = useMemo(readPalette, [])
  const theme = useMemo(() => chartTheme(palette), [palette])
  const animate = useMemo(() => !prefersReducedMotion(), [])
  const [active, setActive] = useState<number | null>(null)
  const tip = useFloatingTip()

  const axisMax = useMemo(
    () => Math.max(USAGE_CAP_KWH, ...analysis.days.map((day) => plotValue(Math.max(day.usage, day.delta ?? 0)))) + 3,
    [analysis]
  )

  const data = useMemo<Datum[]>(
    () =>
      analysis.days.map((day) => ({
        day: String(Number(day.date.slice(8))),
        value: plotValue(day.usage)
      })),
    [analysis]
  )

  const { show, hide } = tip
  const layers = useMemo(() => {
    const context: LayerContext = { analysis, palette, onActive: setActive, showTip: show, hideTip: hide }
    return [
      floorLayer(context),
      guideLinesLayer(context),
      'bars',
      baselineLayer(context),
      meterLayer(context),
      cutLayer(context),
      guidePillsLayer(context),
      hoverLayer(context)
    ] as const
  }, [analysis, palette, show, hide])

  return (
    <div
      className={styles.frame}
      role="img"
      aria-label="Daily energy usage as logged, with the meter-derived values as points"
    >
      <div className={styles.canvas}>
        <ActiveContext.Provider value={active}>
          <ResponsiveBar<Datum>
            data={data}
            keys={['value']}
            indexBy="day"
            layers={layers}
            margin={MARGIN}
            padding={0.46}
            borderRadius={4}
            valueScale={{ type: 'linear', min: 0, max: axisMax }}
            colors={(bar) => {
              const color = barColor(analysis.days[bar.index], palette)
              return active === null || active === bar.index ? color : withAlpha(color, DIMMED_ALPHA)
            }}
            enableLabel={false}
            enableGridX={false}
            enableGridY={false}
            axisLeft={null}
            axisBottom={null}
            theme={theme}
            animate={animate}
            motionConfig="gentle"
            isInteractive={false}
          />
        </ActiveContext.Provider>
      </div>
      {tip.element}
    </div>
  )
}
