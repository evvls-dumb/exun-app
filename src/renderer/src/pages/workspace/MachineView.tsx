import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { localDate, type CrossCheck, type MachineReport } from '@shared/machine'
import type { Analysis } from '@shared/meter'
import CabinetLine, { type CabinetRange } from '@/components/charts/CabinetLine'
import { formatShortDate } from '@/lib/format'
import LumaSpin from '@/components/LumaSpin'
import type { MachineState } from '@/hooks/useMachine'
import CabinetSummary from './CabinetSummary'
import Explanations from './Explanations'
import Forensics from './Forensics'
import JournalWidget from './Journal'
import Widget from './Widget'
import ledger from './Ledger.module.css'
import styles from './MachineView.module.css'

const RANGES: { id: CabinetRange; label: string }[] = [
  { id: 'week', label: '7 days' },
  { id: 'years', label: '2 years' }
]

function period(start: string, end: string): string {
  const label = (at: string) => `${formatShortDate(localDate(at))} ’${localDate(at).slice(2, 4)}`
  return `${label(start)} – ${label(end)}`
}

interface MachineBoardProps {
  meter: Analysis
  report: MachineReport
  cross: CrossCheck
}

function MachineBoard({ meter, report, cross }: MachineBoardProps) {
  const [range, setRange] = useState<CabinetRange>('week')
  const { analysis, seal } = report
  const review = cross.checks.filter((check) => !check.passed).length
  const swaps = analysis.hardwareChanges.map((change) => change.at)

  return (
    <main className={styles.grid}>
      <Widget
        area="power"
        title={range === 'week' ? 'Cabinet power (W)' : 'Cabinet energy per day, 7-day average (Wh)'}
        revealed
        meta={
          <div className={ledger.tabs} role="group" aria-label="Time range">
            {RANGES.map(({ id, label }) => (
              <button
                key={id}
                className={ledger.tab}
                type="button"
                aria-pressed={range === id}
                onClick={() => setRange(id)}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <CabinetLine range={range} recent={analysis.recent} daily={analysis.daily} swaps={swaps} />
      </Widget>

      <Widget
        area="cabinet"
        title="Cabinet summary"
        meta={period(analysis.coverage.start, analysis.coverage.end)}
        revealed
        accent
      >
        <CabinetSummary meter={meter} analysis={analysis} cross={cross} seal={seal} />
      </Widget>

      <Widget area="explain" title="Official explanations" meta="Tested against the evidence" revealed>
        <Explanations explanations={cross.explanations} />
      </Widget>

      <Widget
        area="checks"
        title="Log forensics"
        meta={review ? <span className={styles.warn}>{review} to review</span> : 'All clear'}
        revealed
      >
        <Forensics checks={cross.checks} />
      </Widget>

      <JournalWidget
        area="journal"
        journal={analysis.journal}
        flagged={analysis.boots.silent.map((boot) => boot.at)}
      />
    </main>
  )
}

interface MachineViewProps {
  meter: Analysis
  machine: MachineState
  cross: CrossCheck | null
}

export default function MachineView({ meter, machine, cross }: MachineViewProps) {
  if (machine.status === 'ready' && cross) {
    return <MachineBoard meter={meter} report={machine.report} cross={cross} />
  }

  return (
    <main className={styles.state}>
      {machine.status === 'error' ? (
        <div className={styles.notice} role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          <p className={styles.noticeTitle}>The cabinet logs can’t be read</p>
          <p className={styles.noticeText}>Run the CLI to pull logs.janus from the machine again.</p>
        </div>
      ) : (
        <>
          <LumaSpin size={48} />
          <p className={styles.noticeText}>Reading logs.janus…</p>
        </>
      )}
    </main>
  )
}
