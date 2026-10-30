import { useEffect, useRef, useState } from 'react'
import Button from '@/components/Button'
import styles from './LoginPage.module.css'

/** Shows a recovery key once. The person must say they have stored it before continuing. */
export default function RecoveryKeyCard({ recoveryKey, onDone, doneLabel = 'Continue' }: { recoveryKey: string; onDone: () => void; doneLabel?: string }) {
  const [stored, setStored] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

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

  return (
    <div className={styles.card}>
      <span className={styles.stepTag}>Recovery key · shown once</span>
      <p className={styles.lead}>
        If you forget your passphrase, this key is the only other way into your cases. Janus does not keep a copy and cannot recover it for you. Write it down or store it in a password manager, somewhere other than this computer.
      </p>
      <div className={styles.keyBox}>{recoveryKey}</div>
      <div className={styles.row}>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? 'Copied (clears in 30 s)' : 'Copy'}
        </Button>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} />
        <span>I have stored this recovery key somewhere safe. I understand it will not be shown again.</span>
      </label>
      <Button onClick={onDone} disabled={!stored}>
        {doneLabel}
      </Button>
    </div>
  )
}
