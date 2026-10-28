import { useCallback, useMemo, useRef, useState } from 'react'
import { crossCheck } from '@shared/machine'
import { analyseLog } from '@shared/meter'
import { useMachine } from '@/hooks/useMachine'
import { todayIso } from '@/lib/format'
import { prefersReducedMotion } from '@/lib/motion'
import AiPage from '@/pages/ai/AiPage'
import type { Session } from '@shared/session'
import AmbientField from './AmbientField'
import DotField from './DotField'
import HomeView from './HomeView'
import MachineView from './MachineView'
import Sidebar, { type View } from './Sidebar'
import Topbar from './Topbar'
import styles from './WorkspacePage.module.css'

interface WorkspacePageProps {
  session: Session
  onLogout: () => void
}

export default function WorkspacePage({ session, onLogout }: WorkspacePageProps) {
  const [view, setView] = useState<View>('home')
  const [intro, setIntro] = useState(() => !prefersReducedMotion())
  const [reached, setReached] = useState<ReadonlySet<string>>(() => new Set())
  const stageRef = useRef<HTMLElement>(null)
  const analysis = useMemo(() => analyseLog(todayIso()), [])
  const machine = useMachine(session.id)
  const cross = useMemo(
    () => (machine.status === 'ready' ? crossCheck(machine.report.analysis, analysis) : null),
    [machine, analysis]
  )
  const cabinet = machine.status === 'ready' ? machine.report.analysis : null
  const latest = cabinet?.thermal.latest ?? null

  const reach = useCallback(
    (area: string) => setReached((current) => new Set(current).add(area)),
    []
  )
  const endIntro = useCallback(() => setIntro(false), [])
  const isRevealed = (area: string) => !intro || reached.has(area)

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <AmbientField active={!intro && view === 'home'} />

        <Topbar
          view={view}
          machineTitle={cabinet?.machine.title ?? session.machineTitle}
          site={cabinet?.machine.site ?? session.site}
        />

        <div className={styles.body}>
          <Sidebar view={view} onViewChange={setView} onLogout={onLogout} />

          {view === 'home' && (
            <HomeView
              analysis={analysis}
              latest={latest}
              stageRef={stageRef}
              isRevealed={isRevealed}
            />
          )}
          {view === 'machine' && <MachineView meter={analysis} machine={machine} cross={cross} />}
          {view === 'ai' && <AiPage analysis={analysis} sessionId={session.id} />}
        </div>

        {intro && <DotField stage={stageRef} onReach={reach} onDone={endIntro} />}
      </div>
    </div>
  )
}
