import { useEffect, useState } from 'react'
import DecryptText from '@/components/DecryptText'
import logo from '@assets/logo.png'
import type { JanusApi } from '@shared/api'
import type { AuthResult, VaultState } from '@shared/privacy'
import Frame, { messageOf } from './Frame'
import styles from './Auth.module.css'

type Mode = 'pass' | 'recovery' | 'reset'
const api = () => (globalThis as unknown as { janus?: JanusApi }).janus?.vault

/** Every launch after setup: passphrase (and keyfile), the recovery key, or, if both are gone, a reset that
 *  erases the vault so setup can start again. */
export default function UnlockScreen({ initial, onDone, onReset }: { initial: VaultState; onDone: (r: AuthResult) => void; onReset: (s: VaultState) => void }) {
  const [state, setState] = useState(initial)
  const [mode, setMode] = useState<Mode>('pass')
  const [pass, setPass] = useState('')
  const [recovery, setRecovery] = useState('')
  const [phrase, setPhrase] = useState('')
  const [keyfile, setKeyfile] = useState<string | undefined>()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(Math.ceil(initial.waitMs / 1000))

  useEffect(() => {
    if (wait <= 0) return
    const t = window.setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => window.clearTimeout(t)
  }, [wait])

  function go(next: Mode) {
    setMode(next)
    setErr(null)
    setPhrase('')
  }

  async function submit() {
    const v = api()
    if (!v || busy || wait > 0) return
    setBusy(true)
    setErr(null)
    try {
      const r = mode === 'recovery' ? await v.unlockWithRecovery(recovery) : await v.unlock({ passphrase: pass, keyfilePath: keyfile })
      setPass('')
      setRecovery('')
      onDone(r)
    } catch (e) {
      setErr(messageOf(e))
      const s = await v.state().catch(() => null)
      if (s) {
        setState(s)
        setWait(Math.ceil(s.waitMs / 1000))
      }
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    const v = api()
    if (!v || busy) return
    setBusy(true)
    setErr(null)
    try {
      await v.destroy('DESTROY')
      onReset(await v.state())
    } catch (e) {
      setErr(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const ready = mode === 'recovery' ? recovery.trim().length > 0 : pass.length > 0 && (!state.keyfile || !!keyfile)
  const title = mode === 'reset' ? 'Reset Janus' : mode === 'recovery' ? 'Use your recovery key' : 'Welcome back, Agent'
  const hint =
    mode === 'reset'
      ? 'This erases the vault and every case in it, for good. Nothing can bring them back, not even a recovery key. Afterwards you set Janus up again from the start.'
      : mode === 'recovery'
        ? 'Paste the key you saved when the vault was created. No keyfile is needed.'
        : 'Enter your passphrase to open the vault.'

  return (
    <Frame centered corner={false}>
      <div className={`${styles.col} ${styles.colNarrow}`}>
        <img className={styles.logoMid} src={logo} alt="Janus" draggable={false} />
        <div className={`${styles.head} ${styles.headCenter}`}>
          <h1 className={styles.title}>{mode === 'pass' ? <DecryptText text={title} /> : title}</h1>
          <p className={styles.hint}>{hint}</p>
        </div>

        {mode === 'reset' ? (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              if (phrase === 'DESTROY') void reset()
            }}
          >
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ul-phrase">
                Type DESTROY to confirm
              </label>
              <input id="ul-phrase" className={styles.input} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder="DESTROY" />
            </div>
            {err && <div className={styles.error}>{err}</div>}
            <div className={styles.actions}>
              <button type="submit" className={styles.dangerBtn} disabled={phrase !== 'DESTROY' || busy}>
                {busy ? 'Erasing…' : 'Erase everything and start over'}
              </button>
              <button type="button" className={styles.ghost} onClick={() => go('pass')}>
                Back
              </button>
            </div>
          </form>
        ) : (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {mode === 'recovery' ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ul-recovery">
                  Recovery key
                </label>
                <input id="ul-recovery" className={styles.input} style={{ fontSize: 15, letterSpacing: '0.04em', userSelect: 'text' }} value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" autoFocus spellCheck={false} autoComplete="off" aria-invalid={err ? true : undefined} />
              </div>
            ) : (
              <>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ul-pass">
                    Passphrase
                  </label>
                  <input id="ul-pass" className={styles.input} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" autoFocus aria-invalid={err ? true : undefined} />
                </div>
                {state.keyfile && (
                  <div className={styles.chip}>
                    <span className={styles.rowText}>
                      <span className={styles.rowLabel}>This vault needs its keyfile</span>
                      <span className={styles.chipName}>{keyfile ? keyfile.split(/[\\/]/).pop() : 'None chosen'}</span>
                    </span>
                    <button
                      type="button"
                      className={styles.small}
                      onClick={async () => {
                        const p = await api()?.pickKeyfile()
                        if (p) setKeyfile(p)
                      }}
                    >
                      {keyfile ? 'Change…' : 'Choose…'}
                    </button>
                  </div>
                )}
              </>
            )}
            {err && <div className={styles.error}>{err}</div>}
            {wait > 0 && (
              <div className={styles.note}>
                <span>
                  Too many wrong attempts. Next try in <span className={styles.mono} style={{ color: 'var(--color-warn)' }}>{wait} s</span>.
                </span>
                {state.failed > 0 && <span className={styles.noteSub}>{state.failed} wrong attempt{state.failed === 1 ? '' : 's'} since this was last opened.</span>}
              </div>
            )}
            {!err && wait === 0 && state.failed > 0 && <div className={styles.hint} style={{ textAlign: 'center', fontSize: 12.5 }}>{state.failed} wrong attempt{state.failed === 1 ? '' : 's'} since this was last opened.</div>}
            <button type="submit" className={styles.primary} disabled={!ready || busy || wait > 0}>
              {busy ? 'Opening…' : 'Unlock'}
            </button>
          </form>
        )}

        {mode !== 'reset' && (
          <div className={styles.links}>
            <button type="button" className={styles.linkBtn} onClick={() => go(mode === 'pass' ? 'recovery' : 'pass')}>
              {mode === 'pass' ? 'Forgot it? Use the recovery key' : 'Use passphrase instead'}
            </button>
            <button type="button" className={styles.linkBtn} style={{ color: 'var(--color-text-muted)' }} onClick={() => go('reset')}>
              Lost both? Reset
            </button>
          </div>
        )}
      </div>
      <button type="button" className={`${styles.ghost} ${styles.quit}`} onClick={() => window.close()}>
        Quit
      </button>
    </Frame>
  )
}
