import { useState } from 'react'
import {
  Calculator,
  ChartColumn,
  FlaskConical,
  ListOrdered,
  Mail,
  NotebookPen,
  Scale,
  Search,
  ChevronRight,
  CircleCheck,
  Coins,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  ScanSearch,
  ShieldCheck,
  Sigma,
  Table2,
  TrendingUp,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { AgentStep } from '@shared/ai'
import styles from './AgentTrace.module.css'

const TOOL_ICONS: Record<string, LucideIcon> = {
  investigate_log: ScanSearch,
  get_records: Table2,
  summarize_period: Sigma,
  detect_anomalies: ScanSearch,
  check_integrity: ShieldCheck,
  compare_periods: GitCompareArrows,
  estimate_impact: Coins,
  project_readings: TrendingUp,
  render_chart: ChartColumn,
  generate_pdf_report: FileText,
  export_csv: FileSpreadsheet,
  inspect_day: Search,
  rank_days: ListOrdered,
  reconcile_ledger: Scale,
  simulate_scenario: FlaskConical,
  calculate: Calculator,
  create_memo: Mail,
  case_notes: NotebookPen
}

interface AgentTraceProps {
  steps: readonly AgentStep[]
  live: boolean
}

function splitLabel(label: string): [string, string] {
  const at = label.indexOf(' · ')
  return at < 0 ? [label, ''] : [label.slice(0, at), label.slice(at + 3)]
}

export default function AgentTrace({ steps, live }: AgentTraceProps) {
  const [open, setOpen] = useState(false)
  const running = [...steps].reverse().find((step) => step.status === 'running')
  const failed = steps.filter((step) => step.status === 'error').length
  const summary = running
    ? `${splitLabel(running.label)[0]}…`
    : `Used ${steps.length} ${steps.length === 1 ? 'tool' : 'tools'}${failed ? ` · ${failed} failed` : ''}`

  return (
    <div className={styles.trace}>
      <button
        className={styles.toggle}
        type="button"
        aria-expanded={open}
        data-live={running ? true : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.summary}>{summary}</span>
        <ChevronRight
          className={styles.chevron}
          data-open={open || undefined}
          size={14}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ol className={styles.timeline}>
          {steps.map((step) => {
            const Icon = TOOL_ICONS[step.tool] ?? Wrench
            const [action, target] = splitLabel(step.label)
            return (
              <li key={step.id} className={styles.step} data-status={step.status}>
                <span className={styles.icon} aria-hidden="true">
                  {step.status === 'running' ? (
                    <span className={styles.spinner} />
                  ) : (
                    <Icon size={14} strokeWidth={1.75} />
                  )}
                </span>
                <span className={styles.body}>
                  <span className={styles.label}>
                    {action}
                    {target && <span className={styles.target}> {target}</span>}
                  </span>
                  {step.summary && <span className={styles.result}>{step.summary}</span>}
                </span>
              </li>
            )
          })}
          {!live && (
            <li className={styles.step} data-status="done">
              <span className={styles.icon} aria-hidden="true">
                <CircleCheck size={14} strokeWidth={1.75} />
              </span>
              <span className={styles.body}>
                <span className={styles.label}>Done</span>
              </span>
            </li>
          )}
        </ol>
      )}
    </div>
  )
}
