import { useCallback, useState } from 'react'
import { useScreenFlow } from '@/hooks/useScreenFlow'
import GreetingPage from '@/pages/greeting/GreetingPage'
import LoginPage from '@/pages/login/LoginPage'
import SessionSetupPage from '@/pages/session/SessionSetupPage'
import SplashScreen from '@/pages/splash/SplashScreen'
import WorkspacePage from '@/pages/workspace/WorkspacePage'
import type { Session } from '@shared/session'
import styles from './App.module.css'

type Screen = 'splash' | 'login' | 'greeting' | 'session' | 'workspace'

export default function App() {
  const { screen, leaving, go, show } = useScreenFlow<Screen>('splash')
  const [session, setSession] = useState<Session | null>(null)

  const showLogin = useCallback(() => show('login'), [show])
  const goToGreeting = useCallback(() => go('greeting'), [go])
  const goToSession = useCallback(() => go('session'), [go])
  const logout = useCallback(() => {
    // Logging out locks the vault: the key is wiped from memory, not just hidden.
    const lock = (globalThis as unknown as { janus?: { vault?: { lock: () => Promise<unknown> } } }).janus?.vault?.lock()
    void Promise.resolve(lock).finally(() => go('login'))
  }, [go])

  function openSession(next: Session) {
    setSession(next)
    go('workspace')
  }

  return (
    <div key={screen} className={styles.stage} data-leaving={leaving || undefined}>
      {screen === 'splash' && <SplashScreen onDone={showLogin} />}
      {screen === 'login' && <LoginPage onLogin={goToGreeting} />}
      {screen === 'greeting' && <GreetingPage onDone={goToSession} />}
      {screen === 'session' && <SessionSetupPage onSessionOpen={openSession} />}
      {screen === 'workspace' && session && <WorkspacePage session={session} onLogout={logout} />}
    </div>
  )
}
