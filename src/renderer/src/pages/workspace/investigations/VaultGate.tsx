import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JanusApi } from '@shared/api'
import type { VaultState } from '@shared/privacy'
import UnlockScreen from '@/pages/login/UnlockScreen'
import { useCases } from './caseStore'

/** Shown instead of any case content while the sealed vault is locked (after inactivity, or "Lock now").
 *  The main process announces the unlock and the case store reloads itself. */
export default function VaultGate() {
  const cases = useCases()
  const [state, setState] = useState<VaultState | null>(null)

  useEffect(() => {
    const api = (globalThis as unknown as { janus?: JanusApi }).janus
    void api?.vault.state().then(setState)
  }, [cases.vault])

  // Full screen, the same unlock as at launch. If it is reset here, start over from the first screen.
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--color-bg)' }}>
      {state && <UnlockScreen initial={state} onDone={() => {}} onReset={() => window.location.reload()} />}
    </div>,
    document.body
  )
}
