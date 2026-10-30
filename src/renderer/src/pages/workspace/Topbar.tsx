import logo from '@assets/logo.png'
import { useCases } from './investigations/caseStore'
import type { View } from './Sidebar'
import SearchBox from './SearchBox'
import styles from './Topbar.module.css'

interface TopbarProps {
  view: View
  onNavigate: (v: View) => void
}

export default function Topbar({ view, onNavigate }: TopbarProps) {
  const callsign = useCases().settings.agent
  return (
    <header className={styles.topbar}>
      <div className={styles.logoSlot}>
        <img className={styles.logo} src={logo} alt="Janus" draggable={false} />
      </div>

      <div className={styles.intros}>
        <div className={styles.intro} data-visible={view === 'home' || undefined} aria-hidden={view !== 'home'}>
          <h1 className={styles.greeting}>Hello, {callsign}</h1>
          <p className={styles.subtitle}>Ready for today’s challenges?</p>
        </div>
        <div
          className={styles.intro}
          data-visible={view === 'investigations' || undefined}
          aria-hidden={view !== 'investigations'}
        >
          <h1 className={styles.greeting}>Investigations</h1>
          <p className={styles.subtitle}>Drop in the evidence. Janus checks it before it weighs it</p>
        </div>
        <div className={styles.intro} data-visible={view === 'privacy' || undefined} aria-hidden={view !== 'privacy'}>
          <h1 className={styles.greeting}>Privacy</h1>
          <p className={styles.subtitle}>What is stored, who can read it, and what ever leaves this machine</p>
        </div>
        <div className={styles.intro} data-visible={view === 'ai' || undefined} aria-hidden={view !== 'ai'}>
          <h1 className={styles.greeting}>
            Janus <span className={styles.accent}>AI Agent</span>
          </h1>
          <p className={styles.subtitle}>Investigates the case data, charts it and writes reports</p>
        </div>
      </div>

      <SearchBox onNavigate={onNavigate} />
      <div className={styles.clearance}>
        Agent {callsign} <span aria-hidden="true">·</span> Clearance &Delta;
      </div>
    </header>
  )
}
