import { formatNumber, formatShortDate } from '../../shared/format'
import {
  VERDICT_LABELS,
  formatShare,
  localDate,
  localTime,
  type CrossCheck,
  type EvidenceSeal,
  type MachineAnalysis
} from '../../shared/machine'
import { GAME_SOURCE, SOURCE_ANALYSIS } from '../../shared/gameSource'
import { isFlagged, type Analysis, type DayRecord } from '../../shared/meter'

export interface ReportEvidence {
  analysis: MachineAnalysis
  cross: CrossCheck
  seal: EvidenceSeal
}

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface ReportInput {
  title: string
  summary: string
  findings: { title: string; severity: Severity; detail: string }[]
  recommendations: string[]
  includeRecords: boolean
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function plain(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*(?:[-*•]|#+)\s+/gm, '')
    .replace(/\s+—\s+/g, ', ')
    .trim()
}

function paragraphs(value: string): string {
  return plain(value)
    .split(/\n{2,}/)
    .map((block) => `<p>${escape(block).replace(/\n/g, ' ')}</p>`)
    .join('')
}

function used(day: DayRecord): number {
  return day.delta ?? day.usage
}

function flagOf(day: DayRecord): string {
  if (day.spike) return 'Spike'
  if (day.mismatch) return 'Log differs from meter'
  if (day.future) return 'Future-dated'
  if (day.delta === null) return 'First entry'
  return ''
}

function chart(analysis: Analysis): string {
  const width = 680
  const height = 190
  const left = 40
  const bottom = 22
  const top = 8
  const plotHeight = height - top - bottom
  const days = analysis.days
  const slot = (width - left) / days.length
  const max = Math.max(...days.map(used), analysis.baseline)
  const ceiling = 10 ** Math.ceil(Math.log10(max))
  const y = (value: number) => top + plotHeight * (1 - Math.log10(Math.max(1, value)) / Math.log10(ceiling))

  const ticks: number[] = []
  for (let tick = 1; tick <= ceiling; tick *= 10) ticks.push(tick)

  const grid = ticks
    .map(
      (tick) =>
        `<line x1="${left}" x2="${width}" y1="${y(tick)}" y2="${y(tick)}" class="grid"/>` +
        `<text x="${left - 6}" y="${y(tick) + 3}" class="tick" text-anchor="end">${formatNumber(tick, 0)}</text>`
    )
    .join('')

  const bars = days
    .map((day, index) => {
      const x = left + index * slot + slot * 0.22
      const barTop = y(used(day))
      const tone = day.spike ? 'spike' : isFlagged(day) ? 'flag' : 'bar'
      const label = index % 2 === 0 || isFlagged(day) ? formatShortDate(day.date) : ''
      return (
        `<rect x="${x}" y="${barTop}" width="${slot * 0.56}" height="${top + plotHeight - barTop}" class="${tone}"/>` +
        (label ? `<text x="${x + slot * 0.28}" y="${height - 6}" class="tick" text-anchor="middle">${label}</text>` : '')
      )
    })
    .join('')

  const base = y(analysis.baseline)
  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Daily consumption">
    ${grid}${bars}
    <line x1="${left}" x2="${width}" y1="${base}" y2="${base}" class="base"/>
    <text x="${width}" y="${base - 4}" class="baseLabel" text-anchor="end">Baseline ${formatNumber(analysis.baseline)} kWh</text>
  </svg>`
}

const STYLES = `
@page { size: A4; margin: 18mm 18mm 20mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 10pt/1.6 "Segoe UI", system-ui, sans-serif; color: #1a1a1a; }
.brand { font-size: 8pt; font-weight: 600; letter-spacing: 0.2em; color: #555; }
h1 { margin: 10px 0 14px; font-size: 19pt; font-weight: 600; line-height: 1.25; }
.meta { width: 100%; border-collapse: collapse; border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; font-size: 8.5pt; }
.meta td { padding: 6px 12px 6px 0; border: 0; vertical-align: top; }
.meta td span { display: block; font-size: 7pt; letter-spacing: 0.08em; text-transform: uppercase; color: #777; }
h2 { display: flex; gap: 10px; margin: 24px 0 8px; font-size: 11pt; font-weight: 600; break-after: avoid; }
h2 .no { min-width: 18px; font-weight: 400; color: #777; }
p { margin: 0 0 8px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; font-variant-numeric: tabular-nums; }
th { padding: 5px 8px 5px 0; border-bottom: 1px solid #1a1a1a; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.06em; text-align: left; text-transform: uppercase; color: #555; }
td { padding: 5px 8px 5px 0; border-bottom: 1px solid #e2e2e2; }
.num { text-align: right; }
.figures td:first-child { width: 65%; color: #444; }
.chart { width: 100%; height: auto; }
.chart .grid { stroke: #ebebeb; stroke-width: 1; }
.chart .tick { font-size: 8px; fill: #777; }
.chart .bar { fill: #9a9a9a; }
.chart .flag { fill: #c98a2b; }
.chart .spike { fill: #b3261e; }
.chart .base { stroke: #1a1a1a; stroke-width: 0.8; stroke-dasharray: 3 3; }
.chart .baseLabel { font-size: 8px; fill: #1a1a1a; }
.caption { margin-top: 4px; font-size: 8pt; color: #666; }
.finding { margin: 0 0 12px; break-inside: avoid; }
.finding h3 { margin: 0 0 2px; font-size: 10pt; font-weight: 600; }
.finding h3 .no { margin-right: 8px; font-weight: 400; color: #777; }
.severity { margin-bottom: 2px; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #666; }
.severity.critical { color: #b3261e; }
.severity.high { color: #9a5b00; }
.finding p { margin: 0; }
ol { margin: 0; padding-left: 18px; }
li { margin-bottom: 5px; }
.review { font-weight: 600; color: #b3261e; }
tr.flagged td { font-weight: 600; }
.records { break-before: page; }
.verdict { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
.verdict.ruled_out { color: #1f6b3a; }
.verdict.unlikely { color: #9a5b00; }
.verdict.open { color: #b3261e; }
.evidence td { vertical-align: top; }
.sub { margin: 18px 0 6px; font-size: 10pt; font-weight: 600; break-after: avoid; }
.hash { font-family: Consolas, "Cascadia Mono", monospace; font-size: 8pt; word-break: break-all; }
.note { margin-top: 28px; padding-top: 8px; border-top: 1px solid #e2e2e2; font-size: 7.5pt; color: #777; }
`

function sourceSection(heading: (text: string) => string): string {
  const analysis = SOURCE_ANALYSIS
  const removed = analysis.removedClasses
  const figures = [
    ['Lines in the original source', String(analysis.original.lines.length)],
    ['Lines in the recovered source', String(analysis.recovered.lines.length)],
    ['Lines removed', String(analysis.removedLines)],
    ['Classes removed', removed.map((item) => item.name).join(', ') || 'None'],
    ['Recovered lines that still use a removed class', String(analysis.dangling.length)],
    ['Recovered source compiles', analysis.compiles ? 'Yes' : 'No']
  ]
  return `${heading('Game source comparison')}
<p>${escape(GAME_SOURCE.title)}, ${escape(GAME_SOURCE.file)}. The original is compared line by line with the copy ${escape(GAME_SOURCE.recovered.origin.toLowerCase())}.</p>
<table class="figures"><tbody>
  ${figures.map(([label, value]) => `<tr><td>${label}</td><td class="num">${escape(value)}</td></tr>`).join('')}
</tbody></table>
${analysis.dangling.length
    ? `<h3 class="sub">Lines that depend on the removed class</h3>
<table class="evidence"><thead><tr><th class="num">Line</th><th>Code</th></tr></thead><tbody>
  ${analysis.dangling.map((use) => `<tr><td class="num">${use.line}</td><td class="hash">${escape(use.text)}</td></tr>`).join('')}
</tbody></table>`
    : ''}`
}

function moment(at: string): string {
  return `${formatShortDate(localDate(at))} ${localDate(at).slice(0, 4)}, ${localTime(at)}`
}

function cabinetSection(evidence: ReportEvidence, heading: (text: string) => string): string {
  const { analysis, cross, seal } = evidence
  const figures = [
    ['Mean cabinet draw', `${formatNumber(analysis.power.meanW, 2)} W`],
    ['Highest recorded draw', `${formatNumber(analysis.power.peakW, 2)} W`],
    ['Most energy the cabinet could use in a day', `${formatNumber(cross.budget.ceilingDailyWh / 1000, 2)} kWh`],
    ['Share of the excess the cabinet could account for', formatShare(cross.budget.sharePct)],
    ['Excess expressed as years of normal cabinet use', `${formatNumber(cross.budget.yearsOfUse)} years`]
  ]
  return `${heading('Arcade cabinet cross-check')}
<p>${escape(analysis.machine.title)}, ${escape(analysis.machine.site)}. Telemetry runs from ${moment(analysis.coverage.start)} to ${moment(analysis.coverage.end)}, ${formatNumber(analysis.coverage.samples, 0)} hourly samples.</p>
<table class="figures"><tbody>
  ${figures.map(([label, value]) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`).join('')}
</tbody></table>
<h3 class="sub">Explanations tested</h3>
<table class="evidence"><thead><tr><th>Explanation</th><th>Raised by</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>
  ${cross.explanations
    .map(
      (item) =>
        `<tr><td>${escape(item.claim)}</td><td>${escape(item.source)}</td><td><span class="verdict ${item.verdict}">${VERDICT_LABELS[item.verdict]}</span></td><td>${escape(item.evidence)}</td></tr>`
    )
    .join('')}
</tbody></table>
<h3 class="sub">Cabinet log forensics</h3>
<table class="evidence"><thead><tr><th>Check</th><th>Detail</th><th class="num">Result</th></tr></thead><tbody>
  ${cross.checks
    .map(
      (check) =>
        `<tr><td>${escape(check.label)}</td><td>${escape(check.detail)}</td><td class="num${check.passed ? '' : ' review'}">${check.passed ? 'Pass' : 'Review'}</td></tr>`
    )
    .join('')}
</tbody></table>
${heading('Evidence seal')}
<table class="evidence"><tbody>
  <tr><td>Algorithm</td><td>${seal.algorithm}</td></tr>
  <tr><td>Fingerprint at sealing</td><td class="hash">${seal.fingerprint}</td></tr>
  <tr><td>Fingerprint now</td><td class="hash">${seal.current}</td></tr>
  <tr><td>Sealed</td><td>${escape(new Date(seal.sealedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</td></tr>
  <tr><td>Status</td><td class="${seal.intact ? '' : 'review'}">${seal.intact ? 'Intact: the logs file is unchanged since sealing' : 'Changed: the logs file differs from the sealed copy'}</td></tr>
</tbody></table>`
}

export function buildReportHtml(
  input: ReportInput,
  analysis: Analysis,
  generatedAt: Date,
  evidence: ReportEvidence | null = null
): string {
  const { days } = analysis
  const first = days[0]
  const last = days[days.length - 1]
  const generated = generatedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  const reference = `JNS-${generatedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${String(generatedAt.getTime()).slice(-4)}`
  let section = 0
  const heading = (text: string) => `<h2><span class="no">${++section}</span>${text}</h2>`

  const figures = [
    ['Baseline consumption (median daily usage)', `${formatNumber(analysis.baseline)} kWh`],
    [`Peak daily consumption, ${formatShortDate(analysis.peak.date)}`, `${formatNumber(analysis.peak.delta ?? 0)} kWh`],
    ['Peak relative to baseline', `${Math.round(analysis.peakFactor)}×`],
    ['Implied average load on the peak day', `${formatNumber(analysis.peakLoadKw)} kW`],
    ['Energy above baseline on spike days', `${formatNumber(analysis.excessKwh)} kWh`],
    ['Logged usage minus metered usage', `${formatNumber(analysis.ledgerGapKwh)} kWh`]
  ]

  const records = days
    .map(
      (day) => `<tr class="${isFlagged(day) ? 'flagged' : ''}">
        <td>${formatShortDate(day.date)}</td>
        <td class="num">${formatNumber(day.reading)}</td>
        <td class="num">${formatNumber(day.usage)}</td>
        <td class="num">${day.delta === null ? '–' : formatNumber(day.delta)}</td>
        <td>${flagOf(day)}</td>
      </tr>`
    )
    .join('')

  const summary = `${heading('Summary')}${paragraphs(input.summary)}`
  const keyFigures = `${heading('Key figures')}
<table class="figures"><tbody>
  ${figures.map(([label, value]) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`).join('')}
</tbody></table>`
  const consumption = `${heading('Daily consumption')}
${chart(analysis)}
<p class="caption">Meter change per day on a logarithmic scale. Spike days are shown in red and other flagged days in amber. The dashed line marks the baseline.</p>`
  const findingsHeading = heading('Findings')
  const findings = input.findings
    .map(
      (finding, index) => `<div class="finding">
      <div class="severity ${finding.severity}">${SEVERITY_LABEL[finding.severity]}</div>
      <h3><span class="no">${section}.${index + 1}</span>${escape(plain(finding.title))}</h3>
      ${finding.detail ? paragraphs(finding.detail) : ''}
    </div>`
    )
    .join('')
  const integrity = `${heading('Log integrity')}
<table><thead><tr><th>Check</th><th class="num">Result</th></tr></thead><tbody>
  ${analysis.checks
    .map(
      (check) =>
        `<tr><td>${escape(check.label)}</td><td class="num${check.passed ? '' : ' review'}">${check.passed ? 'Pass' : 'Review'}</td></tr>`
    )
    .join('')}
</tbody></table>`
  const actions = input.recommendations.length
    ? `${heading('Recommended actions')}<ol>${input.recommendations.map((item) => `<li>${escape(plain(item))}</li>`).join('')}</ol>`
    : ''
  const appendix = input.includeRecords
    ? `<section class="records"><h2><span class="no">A</span>Appendix: daily records</h2>
  <table>
    <thead><tr><th>Date</th><th class="num">Meter reading (kWh)</th><th class="num">Logged usage (kWh)</th><th class="num">Meter change (kWh)</th><th>Flag</th></tr></thead>
    <tbody>${records}</tbody>
  </table></section>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escape(plain(input.title))}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="brand">JANUS</div>
<h1>${escape(plain(input.title))}</h1>
<table class="meta"><tr>
  <td><span>Period</span>${formatShortDate(first.date)} – ${formatShortDate(last.date)} ${last.date.slice(0, 4)}</td>
  <td><span>Records</span>${days.length} daily readings</td>
  <td><span>Prepared</span>${escape(generated)}</td>
  <td><span>Reference</span>${reference}</td>
  ${evidence ? `<td><span>Evidence</span>${evidence.seal.intact ? 'Sealed, intact' : 'Seal broken'}</td>` : ''}
</tr></table>
${summary}
${keyFigures}
${consumption}
${findingsHeading}
${findings}
${integrity}
${evidence ? cabinetSection(evidence, heading) : ''}
${sourceSection(heading)}
${actions}
<p class="note">Figures in this report are computed directly from the Energy Dossier meter log${evidence ? ' and the cabinet telemetry in logs.janus' : ''}. Statements about causes are inferences and should be verified on site before any action is taken.</p>
${appendix}
</body>
</html>`
}

export interface MemoInput {
  to: string
  from: string
  subject: string
  body: string
}

const MEMO_STYLES = `
@page { size: A4; margin: 22mm 22mm 24mm; }
body { margin: 0; font: 10.5pt/1.65 "Segoe UI", system-ui, sans-serif; color: #1a1a1a; }
.brand { font-size: 8pt; font-weight: 600; letter-spacing: 0.2em; color: #555; }
h1 { margin: 8px 0 18px; font-size: 18pt; font-weight: 600; }
.fields { width: 100%; border-collapse: collapse; border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; margin-bottom: 20px; font-size: 9.5pt; }
.fields th { width: 80px; padding: 5px 0; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.08em; text-align: left; text-transform: uppercase; color: #777; }
.fields td { padding: 5px 0; }
p { margin: 0 0 10px; }
`

export function buildMemoHtml(input: MemoInput, generatedAt: Date): string {
  const date = generatedAt.toLocaleDateString('en-IN', { dateStyle: 'long' })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(plain(input.subject))}</title>
<style>${MEMO_STYLES}</style>
</head>
<body>
<div class="brand">JANUS</div>
<h1>Memorandum</h1>
<table class="fields">
  <tr><th>To</th><td>${escape(plain(input.to))}</td></tr>
  <tr><th>From</th><td>${escape(plain(input.from))}</td></tr>
  <tr><th>Date</th><td>${escape(date)}</td></tr>
  <tr><th>Subject</th><td>${escape(plain(input.subject))}</td></tr>
</table>
${paragraphs(input.body)}
</body>
</html>`
}
