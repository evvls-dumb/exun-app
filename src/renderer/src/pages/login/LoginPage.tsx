import { useEffect, useState } from 'react'
import type { JanusApi } from '@shared/api'
import type { AuthResult, VaultState } from '@shared/privacy'
import RecoveryScreen from './RecoveryScreen'
import SetupFlow from './SetupFlow'
import UnlockScreen from './UnlockScreen'
import styles from './Auth.module.css'

interface LoginPageProps {
  onLogin: () => void
}

/** The way in. First run: set up the vault. After that: open it. There is no account to log in to; the
 *  passphrase is what decrypts your cases, so a wrong one gets nothing. */
export default function LoginPage({ onLogin }: LoginPageProps) {
  const api = (globalThis as unknown as { janus?: JanusApi }).janus?.vault
  const [state, setState] = useState<VaultState | null>(null)
  const [upgraded, setUpgraded] = useState<AuthResult | null>(null)

  useEffect(() => {
    // Without the desktop app there is no vault to open: a plain browser preview just continues.
    if (!api) {
      onLogin()
      return
    }
    void api.state().then((s) => {
      if (s.mode === 'sealed' && !s.locked) onLogin()
      else setState(s)
    })
  }, [api, onLogin])

  if (!state) return <main className={styles.page} />

  if (upgraded?.recoveryKey) {
    return <RecoveryScreen recoveryKey={upgraded.recoveryKey} onDone={onLogin} title="Vault upgraded: new recovery key" setup={false} />
  }

  const needsSetup = state.empty || state.mode === 'plain'
  return needsSetup ? (
    <SetupFlow onDone={onLogin} onRestored={setState} />
  ) : (
    <UnlockScreen
      initial={state}
      onReset={setState}
      onDone={(r) => {
        if (r.recoveryKey) setUpgraded(r)
        else onLogin()
      }}
    />
  )
}
