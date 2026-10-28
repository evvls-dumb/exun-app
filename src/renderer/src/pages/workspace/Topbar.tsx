import { Search } from 'lucide-react'
import logo from '@assets/logo.png'
import Button from '@/components/Button'
import { AGENT_CODENAME } from '@/config'
import type { View } from './Sidebar'
import styles from './Topbar.module.css'

interface TopbarProps {
  view: View
  machineTitle?: string
  site?: string
}

export default function Topbar({ view, machineTitle, site }: TopbarProps) {
  const cabinet = [machineTitle, site?.split(',')[0]].filter(Boolean).join(' · ')

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
          <p className={styles.subtitle}>{cabinet ? `${cabinet} · from logs.janus` : 'Cabinet telemetry from logs.janus'}</p>
        </div>
        <div className={styles.intro} data-visible={view === 'ai' || undefined} aria-hidden={view !== 'ai'}>
          <h1 className={styles.greeting}>
            Janus <span className={styles.accent}>AI Agent</span>
          </h1>
          <p className={styles.subtitle}>Investigates the meter log and the arcade box, charts them and writes reports</p>
        </div>
      </div>

      <label className={styles.search}>
        <Search size={16} aria-hidden="true" />
        <input
          className={styles.input}
          type="search"
          placeholder="Search for events & more"
          aria-label="Search"
          spellCheck={false}
        />
      </label>
      <Button className={styles.premium}>hi lol</Button>
    </header>
  )
}
