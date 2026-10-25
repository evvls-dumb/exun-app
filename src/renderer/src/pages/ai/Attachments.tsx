import { useMemo, useState } from 'react'
import { ResponsiveBar, type BarCustomLayer } from '@nivo/bar'
import { ResponsiveLine } from '@nivo/line'
import { chartTheme, readPalette, withAlpha } from '@/components/charts/palette'
import { formatNumber, formatShortDate } from '@/lib/format'
import type { Attachment, ChartSpec } from '@shared/ai'
import styles from './Attachments.module.css'

const MARGIN = { top: 24, right: 14, bottom: 30, left: 52 }
const LOG_SCALE_RATIO = 15
const MAX_LABELLED_BARS = 16

type Tone = 'spike' | 'flag' | undefined
type Datum = { date: string; value: number }

function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1] ?? 0
}

function compact(value: number): string {
  return Math.abs(value) >= 1000 ? formatNumber(value, 0) : formatNumber(value, value % 1 ? 1 : 0)
}

function ChatChart({ chart }: { chart: ChartSpec }) {
  const palette = useMemo(readPalette, [])
  const theme = useMemo(() => chartTheme(palette), [palette])
  const digits = chart.unit === 'kW' ? 2 : 1
  const data = chart.points.map((point) => ({
    date: formatShortDate(point.date),
    value: point.value,
    flagged: point.flagged,
    tone: (point.tone ?? (point.flagged ? 'spike' : undefined)) as Tone
  }))
  const positive = data.map((item) => item.value).filter((value) => value > 0)
  const max = Math.max(0, ...positive)
  const logScale = chart.kind === 'bar' && positive.length > 2 && max / (middle(positive) || 1) > LOG_SCALE_RATIO
  const logTicks: number[] = [0]
  for (let tick = 1; tick <= max * 10 && logTicks.length < 7; tick *= 10) logTicks.push(tick)

  const toneColour = (tone: Tone) =>
    tone === 'spike' ? palette.danger : tone === 'flag' ? palette.warn : withAlpha(palette.accent, 0.75)

  const valueLabels: BarCustomLayer<Datum> = ({ bars }) =>
    bars.length > MAX_LABELLED_BARS ? null : (
      <g>
        {bars.map((bar) => (
          <text
            key={bar.key}
            x={bar.x + bar.width / 2}
            y={bar.y - 6}
            textAnchor="middle"
            style={{ fill: data[bar.index]?.tone ? palette.text : palette.muted, fontSize: 10, fontFamily: palette.mono }}
          >
            {compact(bar.data.value ?? 0)}
          </text>
        ))}
      </g>
    )
  const step = data.length > 10 ? 2 : 1
  const ticks = data.filter((_, index) => index % step === 0).map((item) => item.date)

  const tip = (label: string | number, value: number, tone: Tone) => (
    <div className={styles.tip}>
      <span className={styles.tipDate}>{label}</span>
      <b>
        {formatNumber(value, digits)} {chart.unit}
      </b>
      {tone && <span className={styles.tipFlag} data-tone={tone}>{tone === 'spike' ? 'Spike' : 'Flagged'}</span>}
    </div>
  )

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartTitle}>
        {chart.title}
        <span className={styles.unit}>
          {chart.unit}
          {logScale && ' · log scale'}
        </span>
      </figcaption>
      <div className={styles.plot}>
        {chart.kind === 'bar' ? (
          <ResponsiveBar<Datum>
            data={data.map(({ date, value }) => ({ date, value }))}
            keys={['value']}
            indexBy="date"
            margin={MARGIN}
            padding={0.3}
            theme={theme}
            borderRadius={3}
            enableLabel={false}
            enableGridY
            valueScale={logScale ? { type: 'symlog' } : { type: 'linear' }}
            gridYValues={logScale ? logTicks : 4}
            axisLeft={{
              tickSize: 0,
              tickPadding: 8,
              tickValues: logScale ? logTicks : 4,
              format: (value) => formatNumber(Number(value), 0)
            }}
            axisBottom={{ tickSize: 0, tickPadding: 10, tickValues: ticks }}
            colors={(bar) => toneColour(data[bar.index]?.tone)}
            layers={['grid', 'axes', 'bars', 'markers', valueLabels]}
            markers={
              chart.baseline === null
                ? []
                : [
                    {
                      axis: 'y',
                      value: chart.baseline,
                      lineStyle: { stroke: palette.muted, strokeWidth: 1, strokeDasharray: '4 4' },
                      legend: 'baseline',
                      legendPosition: 'top-left',
                      textStyle: { fill: palette.muted, fontSize: 10 }
                    }
                  ]
            }
            tooltip={(bar) => tip(bar.indexValue, bar.value ?? 0, data[bar.index]?.tone)}
            animate={false}
          />
        ) : (
          <ResponsiveLine
            data={[{ id: chart.title, data: data.map((item) => ({ x: item.date, y: item.value, tone: item.tone })) }]}
            margin={MARGIN}
            theme={theme}
            colors={[palette.accent]}
            yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
            axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4, format: (value) => formatNumber(Number(value), 0) }}
            axisBottom={{ tickSize: 0, tickPadding: 10, tickValues: ticks }}
            enableGridX={false}
            curve="monotoneX"
            lineWidth={2}
            pointSize={6}
            pointColor={palette.card}
            pointBorderWidth={2}
            pointBorderColor={{ from: 'serieColor' }}
            useMesh
            tooltip={({ point }) => tip(String(point.data.x), Number(point.data.y), point.data.tone as Tone)}
            animate={false}
          />
        )}
      </div>
    </figure>
  )
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function FileCard({ attachment }: { attachment: Extract<Attachment, { kind: 'file' }> }) {
  const [missing, setMissing] = useState(false)

  async function open(reveal: boolean) {
    setMissing(!(await window.janus.ai.openFile(attachment.path, reveal)))
  }

  return (
    <div className={styles.file} data-format={attachment.format}>
      <span className={styles.badge} aria-hidden="true">
        {attachment.format.toUpperCase()}
      </span>
      <span className={styles.fileText}>
        <span className={styles.fileName}>{attachment.name}</span>
        <span className={styles.fileMeta}>
          {missing ? 'This file was moved or deleted.' : `${attachment.description} · ${size(attachment.bytes)}`}
        </span>
      </span>
      <span className={styles.fileActions}>
        <button className={styles.primary} type="button" onClick={() => void open(false)}>
          Open
        </button>
        <button className={styles.secondary} type="button" onClick={() => void open(true)}>
          Show in folder
        </button>
      </span>
    </div>
  )
}

export default function Attachments({ items }: { items: readonly Attachment[] }) {
  if (items.length === 0) return null
  return (
    <div className={styles.list}>
      {items.map((item) =>
        item.kind === 'chart' ? (
          <ChatChart key={item.id} chart={item.chart} />
        ) : (
          <FileCard key={item.id} attachment={item} />
        )
      )}
    </div>
  )
}
