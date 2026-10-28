import logo from '@assets/logo.png'
import { AGENT_CODENAME } from '@/config'
import type { View } from './Sidebar'
import styles from './Topbar.module.css'

interface TopbarProps {
  view: View
  site?: string
}

export default function Topbar({ view, site }: TopbarProps) {
  const arcade = site?.split(',')[0]

  return (
    <header className={styles.topbar}>
      <div className={styles.logoSlot}>
        <img className={styles.logo} src={logo} alt="Janus" draggable={false} />
      </div>

      <div className={styles.intros}>
        <div className={styles.intro} data-visible={view === 'home' || undefined} aria-hidden={view !== 'home'}>
          <h1 className={styles.greeting}>Hello, {AGENT_CODENAME}</h1>
          <p className={styles.subtitle}>EXUN is suspended. The case isn’t.</p>
        </div>
        <div className={styles.intro} data-visible={view === 'machine' || undefined} aria-hidden={view !== 'machine'}>
          <h1 className={styles.greeting}>
            Arcade Box <span className={styles.accent}>Analysis</span>
          </h1>
          <p className={styles.subtitle}>{arcade ? `${arcade} · cabinet telemetry from logs.janus` : 'Cabinet telemetry from logs.janus'}</p>
        </div>
        <div className={styles.intro} data-visible={view === 'source' || undefined} aria-hidden={view !== 'source'}>
          <h1 className={styles.greeting}>
            Game Source <span className={styles.accent}>Forensics</span>
          </h1>
          <p className={styles.subtitle}>Check the game code for any changes or tamper</p>
        </div>
        <div className={styles.intro} data-visible={view === 'ai' || undefined} aria-hidden={view !== 'ai'}>
          <h1 className={styles.greeting}>
            Janus <span className={styles.accent}>AI Agent</span>
          </h1>
          <p className={styles.subtitle}>Investigates the meter log, the arcade box and the game source, and writes reports</p>
        </div>
      </div>
    </header>
  )
}
