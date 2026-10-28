import { Wifi, WifiOff } from 'lucide-react'
import { useOnline } from '@/hooks/useOnline'
import styles from './AgentNotice.module.css'

export default function AgentNotice() {
  const online = useOnline()

  return (
    <p className={styles.notice} data-offline={!online || undefined} role="status">
      {online ? (
        <Wifi size={12} strokeWidth={2} aria-hidden="true" />
      ) : (
        <WifiOff size={12} strokeWidth={2} aria-hidden="true" />
      )}
      {online
        ? 'The agent runs online. Your questions and the evidence it reads are sent to the AI service provider.'
        : 'You’re offline. Dashboards still work, but the agent needs a connection.'}
    </p>
  )
}
