import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import Button from '@/components/Button'
import styles from './KeySetup.module.css'

interface KeySetupProps {
  canStoreKey: boolean
  onSave: (key: string) => Promise<string | null>
}

export default function KeySetup({ canStoreKey, onSave }: KeySetupProps) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!key.trim() || saving) return
    setSaving(true)
    setError(await onSave(key))
    setSaving(false)
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <span className={styles.icon} aria-hidden="true">
          <KeyRound size={20} strokeWidth={1.75} />
        </span>
        <h3 className={styles.title}>Connect your Groq API key</h3>
        <p className={styles.text}>
          Janus sends your questions to Groq with your own API key. The key stays on this
          device, encrypted with your Windows account, and is only used from the app’s main process.
        </p>

        {canStoreKey ? (
          <>
            <input
              className={styles.input}
              type="password"
              value={key}
              placeholder="Paste your Groq API key"
              aria-label="Groq API key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setKey(event.target.value)}
            />
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={!key.trim() || saving}>
              {saving ? 'Saving…' : 'Save key'}
            </Button>
          </>
        ) : (
          <p className={styles.error} role="alert">
            Secure storage isn’t available on this system, so a key can’t be saved. Set the
            GROQ_API_KEY environment variable and restart Janus.
          </p>
        )}
      </form>
    </div>
  )
}
