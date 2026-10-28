import { useMemo, useState } from 'react'
import type { SourceAnalysis } from '@shared/source'
import CodeLine from '@/components/CodeLine'
import Widget from './Widget'
import ledger from './Ledger.module.css'
import styles from './SourceCode.module.css'

type Mode = 'changes' | 'original' | 'recovered'
type Tone = 'removed' | 'added' | 'use'

type Row =
  | { kind: 'line'; key: string; oldLine: number | null; newLine: number | null; marker: string; text: string; tone?: Tone; note?: string }
  | { kind: 'fold'; key: string; label: string; tone?: Tone }

const CONTEXT_LINES = 3

function changeRows(analysis: SourceAnalysis): Row[] {
  const { diff } = analysis
  const near = diff.map((_, index) =>
    diff.slice(Math.max(0, index - CONTEXT_LINES), index + CONTEXT_LINES + 1).some((line) => line.kind !== 'same')
  )
  const rows: Row[] = []
  let hidden = 0
  const flush = (index: number) => {
    if (hidden) rows.push({ kind: 'fold', key: `fold-${index}`, label: `${hidden} unchanged ${hidden === 1 ? 'line' : 'lines'}` })
    hidden = 0
  }
  diff.forEach((line, index) => {
    if (!near[index]) {
      hidden += 1
      return
    }
    flush(index)
    rows.push({
      kind: 'line',
      key: `diff-${index}`,
      oldLine: line.oldLine,
      newLine: line.newLine,
      marker: line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : '',
      text: line.text,
      tone: line.kind === 'same' ? undefined : line.kind
    })
  })
  flush(diff.length)
  return rows
}

function originalRows(analysis: SourceAnalysis): Row[] {
  const removed = new Set(analysis.diff.flatMap((line) => (line.kind === 'removed' && line.oldLine ? [line.oldLine] : [])))
  return analysis.original.lines.map((text, index) => ({
    kind: 'line',
    key: `original-${index}`,
    oldLine: index + 1,
    newLine: null,
    marker: removed.has(index + 1) ? '−' : '',
    text,
    tone: removed.has(index + 1) ? 'removed' : undefined
  }))
}

function recoveredRows(analysis: SourceAnalysis): Row[] {
  const uses = new Map(analysis.dangling.map((use) => [use.line, use]))
  const firstRemoved = analysis.diff.findIndex((line) => line.kind === 'removed')
  const before = [...analysis.diff.slice(0, Math.max(0, firstRemoved))].reverse().find((line) => line.newLine !== null)
  const gapAfter = firstRemoved < 0 ? -1 : (before?.newLine ?? 0)
  const rows: Row[] = []
  if (gapAfter === 0) rows.push({ kind: 'fold', key: 'gap', label: `${analysis.removedLines} lines removed here`, tone: 'removed' })
  analysis.recovered.lines.forEach((text, index) => {
    const use = uses.get(index + 1)
    rows.push({
      kind: 'line',
      key: `recovered-${index}`,
      oldLine: null,
      newLine: index + 1,
      marker: use ? '!' : '',
      text,
      tone: use ? 'use' : undefined,
      note: use ? `Uses ${use.name}, which is no longer declared` : undefined
    })
    if (index + 1 === gapAfter) {
      rows.push({ kind: 'fold', key: 'gap', label: `${analysis.removedLines} lines removed here`, tone: 'removed' })
    }
  })
  return rows
}

interface SourceCodeProps {
  analysis: SourceAnalysis
  file: string
  area: string
}

export default function SourceCode({ analysis, file, area }: SourceCodeProps) {
  const [mode, setMode] = useState<Mode>('changes')
  const types = useMemo(() => new Set(analysis.original.classes.map((item) => item.name)), [analysis])
  const rows = useMemo(
    () => (mode === 'changes' ? changeRows(analysis) : mode === 'original' ? originalRows(analysis) : recoveredRows(analysis)),
    [mode, analysis]
  )

  const tabs = [
    { id: 'changes', label: 'Changes', count: `−${analysis.removedLines}` },
    { id: 'original', label: 'Original', count: String(analysis.original.lines.length) },
    { id: 'recovered', label: 'Recovered', count: String(analysis.recovered.lines.length) }
  ] as const

  return (
    <Widget
      area={area}
      title={file}
      revealed
      meta={
        <div className={ledger.tabs} role="group" aria-label="Source view">
          {tabs.map(({ id, label, count }) => (
            <button
              key={id}
              className={ledger.tab}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              {label}
              <span className={ledger.count}>{count}</span>
            </button>
          ))}
        </div>
      }
    >
      <div className={styles.scroll}>
        <table className={styles.table}>
          <tbody>
            {rows.map((row) =>
              row.kind === 'fold' ? (
                <tr key={row.key} className={styles.fold} data-tone={row.tone}>
                  <td colSpan={4}>{row.label}</td>
                </tr>
              ) : (
                <tr key={row.key} data-tone={row.tone} title={row.note}>
                  {mode !== 'recovered' && <td className={styles.number}>{row.oldLine ?? ''}</td>}
                  {mode !== 'original' && <td className={styles.number}>{row.newLine ?? ''}</td>}
                  <td className={styles.marker}>{row.marker}</td>
                  <td className={styles.text}>
                    <CodeLine text={row.text} types={types} />
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </Widget>
  )
}
