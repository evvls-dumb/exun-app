import { useEffect, useRef, type CSSProperties } from 'react'
import { BrainCircuit, CircleUserRound, FolderSearch, House, LogOut, ShieldCheck } from 'lucide-react'
import styles from './Sidebar.module.css'

export type View = 'home' | 'investigations' | 'ai' | 'privacy'

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'investigations', label: 'Investigations', icon: FolderSearch },
  { id: 'ai', label: 'AI chat', icon: BrainCircuit },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck }
] as const

const LEAD_MS = 260
const TRAIL_MS = 440

interface SidebarProps {
  view: View
  onViewChange: (view: View) => void
  onLogout: () => void
}

export default function Sidebar({ view, onViewChange, onLogout }: SidebarProps) {
  const index = NAV_ITEMS.findIndex((item) => item.id === view)
  const previous = useRef(index)
  const movingDown = index >= previous.current

  useEffect(() => {
    previous.current = index
  }, [index])

  const indicator = {
    '--index': index,
    '--top-ms': `${movingDown ? TRAIL_MS : LEAD_MS}ms`,
    '--bottom-ms': `${movingDown ? LEAD_MS : TRAIL_MS}ms`
  } as CSSProperties

  return (
    <nav className={styles.sidebar} aria-label="Main">
      <ul className={`${styles.pill} ${styles.items}`} data-ambient-fade>
        <li className={styles.indicator} style={indicator} aria-hidden="true" />
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <button
              className={styles.item}
              type="button"
              aria-label={label}
              title={label}
              aria-current={id === view ? 'page' : undefined}
              data-active={id === view || undefined}
              onClick={() => onViewChange(id)}
            >
              <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.pill} data-ambient-fade>
        <button className={styles.item} type="button" aria-label="Account" title="Account">
          <CircleUserRound size={19} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          className={styles.item}
          type="button"
          aria-label="Log out"
          title="Log out"
          onClick={onLogout}
        >
          <LogOut size={19} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}
