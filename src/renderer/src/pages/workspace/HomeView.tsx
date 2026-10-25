import type { RefObject } from 'react'
import { Fan } from 'lucide-react'
import type { Analysis } from '@shared/meter'
import { formatNumber, formatShortDate } from '@/lib/format'
import { ReadingChart, UsageChart, UsageLegend } from './Charts'
import LedgerWidget from './Ledger'
import MachineTemp from './MachineTemp'
import Summary from './Summary'
import Widget from './Widget'
import styles from './HomeView.module.css'

interface HomeViewProps {
  analysis: Analysis
  stageRef: RefObject<HTMLElement | null>
  isRevealed: (area: string) => boolean
}

export default function HomeView({ analysis, stageRef, isRevealed }: HomeViewProps) {
  const { days, projectionGapKwh } = analysis
  const period = `${formatShortDate(days[0].date)} – ${formatShortDate(days[days.length - 1].date)}`

  return (
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
  )
}
