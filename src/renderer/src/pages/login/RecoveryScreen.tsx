import { useEffect, useRef, useState } from 'react'
import type { JanusApi } from '@shared/api'
import Frame, { CheckIcon, messageOf } from './Frame'
import Stepper from './Stepper'
import styles from './Auth.module.css'

/** The recovery key. Shown once, hidden until asked for, and the way on is typing its last group: proof it was
 *  copied somewhere, not just clicked past. */
export default function RecoveryScreen({
  recoveryKey,
  onDone,
  title = 'Your recovery key',
  doneLabel = 'Enter Janus',
  setup = true
}: {
  recoveryKey: string
  onDone: () => void
  title?: string
  doneLabel?: string
  setup?: boolean
}) {
  const api = (globalThis as unknown as { janus?: JanusApi }).janus?.vault
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [last, setLast] = useState('')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const groups = recoveryKey.split('-')
  const tail = groups[groups.length - 1]
  const matches = last.trim().toUpperCase() === tail.toUpperCase()

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey)
      setCopied(true)
      // Do not leave a master secret on the clipboard.
      timer.current = window.setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30_000)
    } catch {
      setCopied(false)
    }
  }

  async function save() {
    setErr(null)
    try {
      const where = await api?.saveRecoveryKey(recoveryKey)
      if (where) setSaved(where.split(/[\\/]/).pop() ?? where)
    } catch (e) {
      setErr(messageOf(e))
    }
  }

  return (
    <Frame stepper={setup ? <Stepper current={4} /> : undefined} centered={!setup}>
      <form
        className={styles.col}
        onSubmit={(e) => {
          e.preventDefault()
          if (shown && matches) onDone()
        }}
      >
        <div className={styles.head}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.hint}>The only other way in if you forget the passphrase. Janus keeps no copy. Store it somewhere other than this computer. Shown once.</p>
        </div>
        <div className={styles.field}>
          <div className={styles.keyWrap}>
            <div className={styles.key} data-hidden={!shown} aria-hidden={!shown}>
              {groups.map((g, i) => (
                <span key={i}>{g}</span>
              ))}
            </div>
            {!shown && (
              <button type="button" className={styles.reveal} onClick={() => setShown(true)}>
                Reveal key
                <span>Make sure no one is looking at your screen</span>
              </button>
            )}
          </div>
          <div className={styles.row}>
            <button type="button" className={styles.small} disabled={!shown} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className={styles.small} disabled={!shown || !api} onClick={() => void save()}>
              {saved ? 'Saved' : 'Save as file'}
            </button>
            <span className={styles.label}>{saved ? saved : copied ? 'Clipboard clears after 30 seconds.' : ''}</span>
          </div>
          {err && <div className={styles.error}>{err}</div>}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rk-last">
            Type the last group to confirm you saved it
          </label>
          <div className={styles.inputWrap}>
            <input
              id="rk-last"
              className={`${styles.input} ${styles.padRight}`}
              data-ok={matches || undefined}
              style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}
              value={last}
              onChange={(e) => setLast(e.target.value)}
              placeholder="????"
              disabled={!shown}
              autoComplete="off"
              spellCheck={false}
            />
            {matches && (
              <span className={`${styles.inside} ${styles.ok}`} style={{ right: 16 }}>
                <CheckIcon size={16} />
              </span>
            )}
          </div>
        </div>
        <button type="submit" className={styles.primary} disabled={!shown || !matches}>
          {doneLabel}
        </button>
      </form>
    </Frame>
  )
}
