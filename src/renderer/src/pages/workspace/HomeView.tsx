import type { RefObject } from 'react'
import { Fan } from 'lucide-react'
import type { Analysis } from '@shared/meter'
import { formatNumber, formatShortDate } from '@/lib/format'
import { ReadingChart, UsageChart, UsageLegend } from './Charts'
import LedgerWidget from './Ledger'
import MachineTemp from './MachineTemp'
import Summary from './Summary'
import Widget from './Widget'
import CaseHome from './CaseHome'
import { useState } from 'react'
import casestyles from './CaseHome.module.css'
import styles from './HomeView.module.css'

interface HomeViewProps {
  analysis: Analysis
  stageRef: RefObject<HTMLElement | null>
  isRevealed: (area: string) => boolean
  onNavigate: (view: 'investigations' | 'privacy') => void
  /** Called when the Site meter tab opens, so the page can play its intro again. */
  onMeterOpen?: () => void
}

export default function HomeView({ analysis, stageRef, isRevealed, onNavigate, onMeterOpen }: HomeViewProps) {
  const [mode, setMode] = useState<'case' | 'meter'>('case')
  const { days, projectionGapKwh } = analysis
  const period = `${formatShortDate(days[0].date)} – ${formatShortDate(days[days.length - 1].date)}`

  const switcher = (
    <div className={casestyles.top}>
      <div className={casestyles.seg} role="tablist" aria-label="Home view">
        <button role="tab" aria-selected={mode === 'case'} className={casestyles.segBtn} data-active={mode === 'case' || undefined} onClick={() => setMode('case')}>
          Active case
        </button>
        <button role="tab" aria-selected={mode === 'meter'} className={casestyles.segBtn} data-active={mode === 'meter' || undefined} onClick={() => {
            if (mode === 'meter') return
            setMode('meter')
            onMeterOpen?.()
          }}>
          Site meter
        </button>
      </div>
      {mode === 'meter' && <span className={casestyles.note}>The site’s supply record. It is the same whichever case is open.</span>}
    </div>
  )

  if (mode === 'case') {
    return (
      <div className={casestyles.wrap}>
        {switcher}
        <main ref={stageRef} className={casestyles.grid}>
          <CaseHome isRevealed={isRevealed} onNavigate={onNavigate} />
        </main>
      </div>
    )
  }

  return (
    <div className={casestyles.wrap}>
      {switcher}
    <main ref={stageRef} className={styles.grid}>
      <Widget
        area="usage"
        title="Daily usage (kWh)"
        meta={<UsageLegend />}
        revealed={isRevealed('usage')}
      >
        <UsageChart analysis={analysis} />
      </Widget>
      <Widget
        area="summary"
        title="Incident summary"
        meta={period}
        revealed={isRevealed('summary')}
        accent
      >
        <Summary analysis={analysis} />
      </Widget>
      <Widget
        area="reading"
        title="Meter reading (kWh)"
        meta={
          <span className={styles.danger}>
            +{formatNumber(projectionGapKwh, 0)} vs projection
          </span>
        }
        revealed={isRevealed('reading')}
      >
        <ReadingChart analysis={analysis} />
      </Widget>
      <LedgerWidget analysis={analysis} area="ledger" revealed={isRevealed('ledger')} />
      <Widget
        area="temp"
        title="Machine Temp"
        icon={<Fan size={15} aria-hidden="true" />}
        meta={
          <span className={styles.sample} title="The meter log has no temperature data">
            Sample
          </span>
        }
        revealed={isRevealed('temp')}
      >
        <MachineTemp />
      </Widget>
    </main>
    </div>
  )
}
