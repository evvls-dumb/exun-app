import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { MIN_QUERY, searchStore, type Hit, type HitKind } from '@shared/search'
import { useCases } from './investigations/caseStore'
import styles from './SearchBox.module.css'

const KIND_LABEL: Record<HitKind, string> = { case: 'Case', evidence: 'Evidence', finding: 'Finding', report: 'Report', action: 'Action', log: 'Log' }

/** Searches everything held in the open vault. Runs in memory on the decrypted store; nothing is indexed to disk. */
export default function SearchBox({ onNavigate }: { onNavigate: (v: 'investigations') => void }) {
  const cases = useCases()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const ready = cases.state === 'ready'

  const hits = useMemo(() => (ready ? searchStore(cases.store, q) : []), [ready, cases.store, q])
  useEffect(() => setCursor(0), [q])

  // Ctrl/Cmd+K from anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(h: Hit) {
    cases.openCase(h.investigationId, h.tab)
    onNavigate('investigations')
    setOpen(false)
    setQ('')
    input.current?.blur()
  }

  const showList = open && q.trim().length > 0
  const tooShort = q.replace(/\s/g, '').length < MIN_QUERY

  return (
    <div className={styles.wrap}>
      <label className={styles.search}>
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          className={styles.input}
          type="search"
          placeholder={ready ? 'Search cases and evidence  ·  Ctrl K' : 'Unlock to search'}
          aria-label="Search cases and evidence"
          aria-expanded={showList}
          aria-controls="search-results"
          role="combobox"
          spellCheck={false}
          autoComplete="off"
          disabled={!ready}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter' && hits[cursor]) {
              e.preventDefault()
              go(hits[cursor])
            } else if (e.key === 'Escape') {
              setQ('')
              setOpen(false)
              input.current?.blur()
            }
          }}
        />
      </label>
      {showList && (
        <ul id="search-results" className={styles.results} role="listbox">
          {tooShort ? (
            <li className={styles.none}>Keep typing…</li>
          ) : hits.length === 0 ? (
            <li className={styles.none}>Nothing in your cases matches “{q.trim()}”.</li>
          ) : (
            hits.map((h, i) => (
              <li key={`${h.kind}-${h.ref ?? h.investigationId}-${i}`} role="option" aria-selected={i === cursor}>
                <button type="button" className={styles.hit} data-active={i === cursor || undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} onMouseEnter={() => setCursor(i)}>
                  <span className={styles.kind}>{KIND_LABEL[h.kind]}</span>
                  <span className={styles.hitMain}>
                    <b>{h.title}</b>
                    <span>{h.snippet}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
