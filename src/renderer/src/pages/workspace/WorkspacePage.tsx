import { useCallback, useMemo, useRef, useState } from 'react'
import { analyseLog } from '@shared/meter'
import { todayIso } from '@/lib/format'
import { prefersReducedMotion } from '@/lib/motion'
import AiPage from '@/pages/ai/AiPage'
import type { Session } from '@shared/session'
import AmbientField from './AmbientField'
import DotField from './DotField'
import HomeView from './HomeView'
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
  const endIntro = useCallback(() => setIntro(false), [])
  const isRevealed = (area: string) => !intro || reached.has(area)

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <AmbientField active={!intro && view === 'home'} />

        <Topbar view={view} />

        <div className={styles.body}>
          <Sidebar view={view} onViewChange={setView} onLogout={onLogout} />

          {view === 'home' ? (
            <HomeView analysis={analysis} stageRef={stageRef} isRevealed={isRevealed} />
          ) : (
            <AiPage analysis={analysis} />
          )}
        </div>

        {intro && <DotField stage={stageRef} onReach={reach} onDone={endIntro} />}
      </div>
    </div>
  )
}
