import { useCallback, useState } from 'react'
import { useScreenFlow } from '@/hooks/useScreenFlow'
import GreetingPage from '@/pages/greeting/GreetingPage'
import LoginPage from '@/pages/login/LoginPage'
import NoticePage from '@/pages/notice/NoticePage'
import SessionSetupPage from '@/pages/session/SessionSetupPage'
import SplashScreen from '@/pages/splash/SplashScreen'
import WorkspacePage from '@/pages/workspace/WorkspacePage'
import { SUSPENSION } from '@shared/caseFile'
import type { Session } from '@shared/session'
import styles from './App.module.css'

type Screen = 'splash' | 'notice' | 'login' | 'greeting' | 'session' | 'workspace'

const ACKNOWLEDGED_KEY = 'janus.acknowledgedNotice'

function readAcknowledged(): boolean {
  try {
    return window.localStorage.getItem(ACKNOWLEDGED_KEY) === SUSPENSION.reference
  } catch {
    return false
  }
}

function writeAcknowledged() {
  try {
    window.localStorage.setItem(ACKNOWLEDGED_KEY, SUSPENSION.reference)
  } catch {
    return
  }
}

export default function App() {
  const { screen, leaving, go, show } = useScreenFlow<Screen>('splash')
  const [session, setSession] = useState<Session | null>(null)

  const leaveSplash = useCallback(() => show(readAcknowledged() ? 'login' : 'notice'), [show])
  const acknowledge = useCallback(() => {
    writeAcknowledged()
    go('login')
  }, [go])
  const goToGreeting = useCallback(() => go('greeting'), [go])
  const goToSession = useCallback(() => go('session'), [go])
  const logout = useCallback(() => go('login'), [go])

  function openSession(next: Session) {
    setSession(next)
    go('workspace')
  }

  return (
    <div key={screen} className={styles.stage} data-leaving={leaving || undefined}>
      {screen === 'splash' && <SplashScreen onDone={leaveSplash} />}
      {screen === 'notice' && <NoticePage onAcknowledge={acknowledge} />}
      {screen === 'login' && <LoginPage onLogin={goToGreeting} />}
      {screen === 'greeting' && <GreetingPage onDone={goToSession} />}
      {screen === 'session' && <SessionSetupPage onSessionOpen={openSession} />}
      {screen === 'workspace' && session && <WorkspacePage session={session} onLogout={logout} />}
    </div>
  )
}
