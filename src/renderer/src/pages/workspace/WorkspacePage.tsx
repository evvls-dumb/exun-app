import { useCallback, useMemo, useRef, useState } from 'react'
import { analyseLog } from '@shared/meter'
import { todayIso } from '@/lib/format'
import { prefersReducedMotion } from '@/lib/motion'
import AiPage from '@/pages/ai/AiPage'
import type { Session } from '@shared/session'
import AmbientField from './AmbientField'
import DotField from './DotField'
import HomeView from './HomeView'
import InvestigationsPage, { CaseStoreProvider } from './investigations/InvestigationsPage'
import PrivacyPage from './privacy/PrivacyPage'
import Sidebar, { type View } from './Sidebar'
import Topbar from './Topbar'
import styles from './WorkspacePage.module.css'

interface WorkspacePageProps {
  session: Session
  onLogout: () => void
}

export default function WorkspacePage({ onLogout }: WorkspacePageProps) {
  const [view, setView] = useState<View>('home')
  const [intro, setIntro] = useState(() => !prefersReducedMotion())
  const [reached, setReached] = useState<ReadonlySet<string>>(() => new Set())
  const stageRef = useRef<HTMLElement>(null)
  const analysis = useMemo(() => analyseLog(todayIso()), [])

  const reach = useCallback(
    (area: string) => setReached((current) => new Set(current).add(area)),
    []
  )
  const [plays, setPlays] = useState(0)
  const endIntro = useCallback(() => setIntro(false), [])
  /** The squares fall into place again each time the Site meter tab is opened. */
  const replayIntro = useCallback(() => {
    if (prefersReducedMotion()) return
    setReached(new Set())
    setIntro(true)
    setPlays((n) => n + 1)
  }, [])
  const isRevealed = (area: string) => !intro || reached.has(area)

  return (
    <CaseStoreProvider>
    <div className={styles.page}>
      <div className={styles.frame}>
        <div className={styles.classbar}>
          <b>JANUS</b>
          <span>Extradigital Exceptions &amp; Unknowns Network</span>
          <span className={styles.sep} />
          <span>Operating under own authority</span>
          <span className={styles.live}>
            <i />
            Live
          </span>
        </div>

        <AmbientField active={!intro && view === 'home'} />

        <Topbar view={view} onNavigate={setView} />

        <div className={styles.body}>
          <Sidebar view={view} onViewChange={setView} onLogout={onLogout} />

          {view === 'home' && (
            <HomeView analysis={analysis} stageRef={stageRef} isRevealed={isRevealed} onNavigate={setView} onMeterOpen={replayIntro} />
          )}
          {view === 'investigations' && <InvestigationsPage />}
          {view === 'privacy' && <PrivacyPage />}
          {view === 'ai' && <AiPage analysis={analysis} />}
        </div>

        {intro && <DotField key={plays} stage={stageRef} onReach={reach} onDone={endIntro} />}
      </div>
    </div>
    </CaseStoreProvider>
  )
}
