import type { ReactNode } from 'react'
import logo from '@assets/logo.png'
import styles from './Auth.module.css'

export const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (\w+Error: )?/, '') : String(e)

/** The page every auth screen sits on: the dot grid, and the logo either small at the top or left to the screen. */
export default function Frame({ children, stepper, centered = false, corner = true }: { children: ReactNode; stepper?: ReactNode; centered?: boolean; corner?: boolean }) {
  return (
    <main className={`${styles.page} ${centered ? styles.pageCentered : ''}`}>
      <div className={styles.dots} aria-hidden="true" />
      {corner && <img className={styles.corner} src={logo} alt="Janus" draggable={false} />}
      {children}
      {stepper}
    </main>
  )
}

export function CheckIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7.5l2.5 2.5L11 4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
