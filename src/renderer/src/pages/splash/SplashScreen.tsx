import { useEffect } from 'react'
import logo from '@assets/logo.png'
import styles from './SplashScreen.module.css'

const SPLASH_MS = 2400

interface SplashScreenProps {
  onDone: () => void
}

export default function SplashScreen({ onDone }: SplashScreenProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, SPLASH_MS)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <main className={styles.page}>
      <img
        className={styles.logo}
        src={logo}
        alt="Janus"
        draggable={false}
        style={{ animationDuration: `${SPLASH_MS}ms` }}
      />
    </main>
  )
}
