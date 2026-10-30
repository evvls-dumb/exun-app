import { useEffect, useState } from 'react'
import DecryptText from '@/components/DecryptText'
import type { JanusApi } from '@shared/api'
import styles from './GreetingPage.module.css'

const HOLD_MS = 1400

interface GreetingPageProps {
  onDone: () => void
}

/** The callsign chosen at setup, read from the unlocked vault. Null until it has been read. */
function useCallsign(): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    const api = (globalThis as unknown as { janus?: JanusApi }).janus
    if (!api) {
      setName('agent')
      return
    }
    let live = true
    void api.investigations
      .load()
      .then((s) => live && setName(s.settings.agent || 'agent'))
      .catch(() => live && setName('agent'))
    return () => {
      live = false
    }
  }, [])
  return name
}

export default function GreetingPage({ onDone }: GreetingPageProps) {
  const name = useCallsign()

  useEffect(() => {
    if (name === null) return
    const timer = setTimeout(onDone, HOLD_MS)
    return () => clearTimeout(timer)
  }, [name, onDone])

  return (
    <main className={styles.page}>
      {name !== null && (
        <h1 className={styles.greeting}>
          <DecryptText text={`Hello, ${name}`} />
        </h1>
      )}
    </main>
  )
}
