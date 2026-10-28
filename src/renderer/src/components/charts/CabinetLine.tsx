import { useMemo, useRef } from 'react'
import { ResponsiveLine, type LineCustomSvgLayer } from '@nivo/line'
import { localDate, localTime, type HourPoint, type MachineDay } from '@shared/machine'
import { formatLongDate, formatNumber, formatShortDate } from '@/lib/format'
import { prefersReducedMotion } from '@/lib/motion'
import ChartTip from './ChartTip'
import { useFloatingTip } from './FloatingTip'
import { chartTheme, readPalette, withAlpha, type Palette } from './palette'
import styles from './NivoCharts.module.css'

export type CabinetRange = 'week' | 'years'

type Series = { id: string; data: { x: number; y: number }[] }

const QUARTER_MONTHS = new Set(['01', '04', '07', '10'])
const SMOOTHING_DAYS = 7
const MONTH_LABEL = new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })

function rollingMean(values: readonly number[], window: number): number[] {
  let sum = 0
  return values.map((value, index) => {
    sum += value
    if (index >= window) sum -= values[index - window]
    return Math.round((sum / Math.min(index + 1, window)) * 10) / 10
  })
}

function activeLayer(recent: readonly HourPoint[], palette: Palette): LineCustomSvgLayer<Series> {
  return function ActiveHours({ xScale, innerHeight }) {
    const runs: { start: number; end: number }[] = []
    recent.forEach((point, index) => {
      if (!point.active) return
      const last = runs[runs.length - 1]
      if (last && last.end === index - 1) last.end = index
      else runs.push({ start: index, end: index })
    })
    return (
      <g className={styles.reveal}>
        {runs.map((run) => {
          const x = xScale(run.start - 0.5)
          return (
            <rect
              key={run.start}
              x={x}
              y={0}
              width={xScale(run.end + 0.5) - x}
              height={innerHeight}
              fill={withAlpha(palette.accent, 0.09)}
              rx={4}
            />
          )
        })}
      </g>
    )
  }
}

interface CabinetLineProps {
  range: CabinetRange
  recent: readonly HourPoint[]
  daily: readonly MachineDay[]
  swaps: readonly string[]
}

export default function CabinetLine({ range, recent, daily, swaps }: CabinetLineProps) {
  const palette = useMemo(readPalette, [])
  const theme = useMemo(() => chartTheme(palette), [palette])
  const animate = useMemo(() => !prefersReducedMotion(), [])
  const tip = useFloatingTip()
  const hovered = useRef<string | null>(null)
  const week = range === 'week'

  const smoothed = useMemo(() => rollingMean(daily.map((day) => day.wh), SMOOTHING_DAYS), [daily])

  const data = useMemo<Series[]>(
    () => [
      {
        id: week ? 'Power' : 'Energy',
        data: week
          ? recent.map((point, index) => ({ x: index, y: point.powerW }))
          : smoothed.map((value, index) => ({ x: index, y: value }))
      }
    ],
    [week, recent, smoothed]
  )

  const ticks = useMemo(
    () =>
      week
        ? recent.flatMap((point, index) => (localTime(point.at) === '00:00' ? [index] : []))
        : daily.flatMap((day, index) =>
            day.date.endsWith('-01') && QUARTER_MONTHS.has(day.date.slice(5, 7)) ? [index] : []
          ),
    [week, recent, daily]
  )

  const swapDays = useMemo(() => new Set(swaps.map(localDate)), [swaps])
  const markers = useMemo(
    () =>
      week
        ? []
        : daily.flatMap((day, index) =>
            swapDays.has(day.date)
              ? [{
                  axis: 'x' as const,
                  value: index,
                  legend: 'Board swap',
                  legendPosition: 'top-right' as const,
                  lineStyle: { stroke: palette.warn, strokeWidth: 1, strokeDasharray: '3 3' },
                  textStyle: { fill: palette.warn, fontSize: 10, fontFamily: palette.mono }
                }]
              : []
          ),
    [week, daily, swapDays, palette]
  )

  const layers = useMemo(
    () =>
      week
        ? (['grid', activeLayer(recent, palette), 'markers', 'axes', 'areas', 'crosshair', 'lines', 'mesh'] as const)
        : (['grid', 'markers', 'axes', 'areas', 'crosshair', 'lines', 'mesh'] as const),
    [week, recent, palette]
  )

  function tipFor(index: number) {
    if (week) {
      const point = recent[index]
      if (!point) return null
      return (
        <ChartTip
          title={`${formatLongDate(localDate(point.at))}, ${localTime(point.at)}`}
          rows={[
            { label: 'Power', value: `${formatNumber(point.powerW, 2)} W` },
            { label: 'CPU', value: `${formatNumber(point.cpuC)} °C` },
            { label: 'Cabinet air', value: `${formatNumber(point.airC)} °C` }
          ]}
          status={point.active ? { label: 'Active', tone: 'info' } : { label: 'Standby', tone: 'neutral' }}
        />
      )
    }
    const day = daily[index]
    if (!day) return null
    const swapped = swapDays.has(day.date)
    return (
      <ChartTip
        title={formatLongDate(day.date)}
        rows={[
          { label: 'Energy', value: `${formatNumber(day.wh)} Wh` },
          { label: '7-day average', value: `${formatNumber(smoothed[index])} Wh` },
          { label: 'Peak draw', value: `${formatNumber(day.peakW, 2)} W` },
          { label: 'Hottest CPU', value: `${formatNumber(day.maxCpuC)} °C` },
          ...(day.players !== null ? [{ label: 'Players', value: formatNumber(day.players, 0) }] : [])
        ]}
        status={
          swapped
            ? { label: 'Controller swapped', tone: 'warning' }
            : { label: `${day.activeHours} active hours`, tone: 'neutral' }
        }
      />
    )
  }

  function showAt(x: unknown, pointer: { clientX: number; clientY: number }) {
    const content = tipFor(Number(x))
    if (content) tip.show(content, pointer)
  }

  return (
    <div
      className={styles.frame}
      role="img"
      aria-label={week ? 'Cabinet power draw by hour over the last seven days, active hours shaded' : 'Cabinet energy per day over two years'}
    >
      <div className={styles.canvas}>
        <ResponsiveLine<Series>
          key={range}
          data={data}
          layers={layers}
          markers={markers}
          margin={{ top: 12, right: 12, bottom: 24, left: 40 }}
          xScale={{ type: 'linear', min: 0, max: Math.max(1, data[0].data.length - 1) }}
          yScale={{ type: 'linear', min: week ? 0 : 'auto', max: 'auto', nice: true }}
          curve="monotoneX"
          colors={[palette.accent]}
          lineWidth={1.75}
          enablePoints={false}
          enableArea={week}
          areaOpacity={0.12}
          enableGridX={false}
          gridYValues={4}
          axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4 }}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: ticks,
            format: (value) => {
              const index = Number(value)
              if (week) return recent[index] ? formatShortDate(localDate(recent[index].at)) : ''
              return daily[index] ? MONTH_LABEL.format(new Date(daily[index].date)) : ''
            }
          }}
          useMesh
          enableCrosshair
          crosshairType="x"
          tooltip={() => <span />}
          onMouseEnter={(target, event) => {
            if (!('data' in target)) return
            hovered.current = target.id
            showAt(target.data.x, event)
          }}
          onMouseMove={(target, event) => {
            if (!('data' in target)) return
            hovered.current = target.id
            showAt(target.data.x, event)
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
