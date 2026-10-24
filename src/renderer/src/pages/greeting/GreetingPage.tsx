import { useEffect } from 'react'
import DecryptText from '@/components/DecryptText'
import { AGENT_CODENAME } from '@/config'
import styles from './GreetingPage.module.css'

const HOLD_MS = 1400

interface GreetingPageProps {
  onDone: () => void
}

export default function GreetingPage({ onDone }: GreetingPageProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, HOLD_MS)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <main className={styles.page}>
      <h1 className={styles.greeting}>
        <DecryptText text={`Hello, ${AGENT_CODENAME}`} />
      </h1>
    </main>
  )
}
