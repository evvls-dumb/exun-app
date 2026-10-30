import { useEffect, useState } from 'react'
import DecryptText from '@/components/DecryptText'
import logo from '@assets/logo.png'
import type { JanusApi } from '@shared/api'
import { crackTime, passphraseStrength, suggestPassphrase } from '@shared/passphrase'
import type { AuthResult, VaultState } from '@shared/privacy'
import { WORDS } from '@shared/wordlist'
import Frame, { CheckIcon, messageOf } from './Frame'
import RecoveryScreen from './RecoveryScreen'
import Stepper from './Stepper'
import styles from './Auth.module.css'

type Screen = 'welcome' | 'callsign' | 'passphrase' | 'keyfile' | 'review' | 'sealing' | 'recovery' | 'restore'
const STAGES = [
  { label: 'Stretching your passphrase', tag: 'scrypt' },
  { label: 'Generating the vault key', tag: '256-bit' },
  { label: 'Making your recovery key', tag: '' },
  { label: 'Writing the encrypted vault', tag: '' }
] as const
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** First run. One question to a screen, in order; Back keeps what was typed. */
export default function SetupFlow({ onDone, onRestored }: { onDone: () => void; onRestored: (s: VaultState) => void }) {
  const api = (globalThis as unknown as { janus?: JanusApi }).janus?.vault
  const [screen, setScreen] = useState<Screen>('welcome')
  const [callsign, setCallsign] = useState('')
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [suggested, setSuggested] = useState(false)
  const [useKeyfile, setUseKeyfile] = useState(false)
  const [keyfile, setKeyfile] = useState<string | undefined>()
  const [err, setErr] = useState<string | null>(null)
  const [stage, setStage] = useState(0)
  const [result, setResult] = useState<AuthResult | null>(null)

  const strength = passphraseStrength(pass)
  const callsignOk = callsign.trim().length >= 2
  const passOk = pass.length >= 8 && pass === again
  const keyOk = !useKeyfile || !!keyfile

  // The steps while the vault is made are a guide to the work being done, paced by the clock; the last one stays
  // open until the main process says it is finished.
  useEffect(() => {
    if (screen !== 'sealing') return
    const t = window.setInterval(() => setStage((s) => Math.min(3, s + 1)), 750)
    return () => window.clearInterval(t)
  }, [screen])

  function suggest() {
    setPass(suggestPassphrase(WORDS, 6))
    setAgain('')
    setShow(true)
    setSuggested(true)
  }

  async function create() {
    if (!api || !callsignOk || !passOk || !keyOk) return
    setErr(null)
    setStage(0)
    setScreen('sealing')
    const started = Date.now()
    try {
      const r = await api.setup({ callsign: callsign.trim(), passphrase: pass, keyfilePath: useKeyfile ? keyfile : undefined })
      await sleep(Math.max(0, 2400 - (Date.now() - started)))
      setStage(4)
      await sleep(400)
      setPass('')
      setAgain('')
      setResult(r)
      setScreen('recovery')
    } catch (e) {
      setErr(messageOf(e))
      setScreen('review')
    }
  }

  async function chooseKeyfile(make: boolean) {
    setErr(null)
    try {
      const p = make ? await api?.createKeyfile() : await api?.pickKeyfile()
      if (p) setKeyfile(p)
    } catch (e) {
      setErr(messageOf(e))
    }
  }

  async function restore() {
    setErr(null)
    try {
      const s = await api?.restore()
      if (s) onRestored(s)
    } catch (e) {
      setErr(messageOf(e))
    }
  }

  if (screen === 'recovery' && result?.recoveryKey) return <RecoveryScreen recoveryKey={result.recoveryKey} onDone={onDone} />

  if (screen === 'welcome') {
    return (
      <Frame centered corner={false}>
        <div className={`${styles.col} ${styles.colNarrow}`} style={{ width: 380 }}>
          <img className={styles.logoBig} src={logo} alt="Janus" draggable={false} />
          <div className={`${styles.head} ${styles.headCenter}`}>
            <h1 className={styles.title}>
              <DecryptText text="Set up your vault" />
            </h1>
            <p className={styles.hint}>Encrypted on this computer. About two minutes.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => setScreen('callsign')} autoFocus>
              Begin
            </button>
            <button type="button" className={styles.ghost} onClick={() => setScreen('restore')}>
              Restore from a backup
            </button>
          </div>
        </div>
      </Frame>
    )
  }

  if (screen === 'restore') {
    return (
      <Frame centered>
        <div className={styles.col}>
          <div className={styles.head}>
            <h1 className={styles.title}>Restore a backup</h1>
            <p className={styles.hint}>Choose a .janus-backup file. It keeps its own passphrase and keyfile, so you will unlock it with those afterwards.</p>
          </div>
          {err && <div className={styles.error}>{err}</div>}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => void restore()}>
              Choose backup file…
            </button>
            <button type="button" className={styles.ghost} onClick={() => setScreen('welcome')}>
              Back
            </button>
          </div>
        </div>
      </Frame>
    )
  }

  if (screen === 'callsign') {
    return (
      <Frame stepper={<Stepper current={0} />}>
        <form
          className={styles.col}
          onSubmit={(e) => {
            e.preventDefault()
            if (callsignOk) setScreen('passphrase')
          }}
        >
          <div className={styles.head}>
            <h1 className={styles.title}>Pick a callsign</h1>
            <p className={styles.hint}>Goes on every note and signature. A working name, not an account.</p>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="su-callsign">
              Callsign
            </label>
            <input id="su-callsign" className={styles.input} value={callsign} onChange={(e) => setCallsign(e.target.value)} autoFocus autoComplete="off" spellCheck={false} maxLength={40} />
          </div>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={!callsignOk}>
              Next
            </button>
            <button type="button" className={styles.ghost} onClick={() => setScreen('welcome')}>
              Back
            </button>
          </div>
        </form>
      </Frame>
    )
  }

  if (screen === 'passphrase') {
    const mismatch = again.length > 0 && again.length >= pass.length && again !== pass
    return (
      <Frame stepper={<Stepper current={1} />}>
        <form
          className={styles.col}
          onSubmit={(e) => {
            e.preventDefault()
            if (passOk) setScreen('keyfile')
          }}
        >
          <div className={styles.head}>
            <h1 className={styles.title}>Choose a passphrase</h1>
            <p className={styles.hint}>{suggested ? 'Six random words. Easy to remember, hard to guess.' : 'Four or five unrelated words beat a short mix of symbols.'}</p>
          </div>
          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="su-pass">
                Passphrase
              </label>
              <button type="button" className={styles.linkBtn} onClick={suggest}>
                {suggested ? 'Suggest another' : 'Suggest six words'}
              </button>
            </div>
            <div className={styles.inputWrap}>
              <input id="su-pass" className={`${styles.input} ${styles.padRight}`} type={show ? 'text' : 'password'} value={pass} onChange={(e) => { setPass(e.target.value); setSuggested(false) }} autoFocus autoComplete="new-password" spellCheck={false} />
              <span className={styles.inside}>
                <button type="button" className={styles.linkBtn} style={{ fontSize: 14 }} onClick={() => setShow((v) => !v)} aria-pressed={show}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </span>
            </div>
            <div className={styles.meter} data-score={strength.score} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className={styles.meterNote}>
              <span style={{ color: strength.score >= 3 ? 'var(--color-success)' : undefined }}>
                {pass.length === 0 ? '' : strength.score === 0 ? 'Too short' : `${strength.label[0].toUpperCase()}${strength.label.slice(1)} · ${crackTime(strength.bits)} to crack`}
              </span>
              {pass.length < 8 && <span>8 characters minimum</span>}
            </div>
          </div>
          {suggested && <p className={styles.warn}>Write these words down now. Janus cannot show them again.</p>}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="su-again">
              {suggested ? 'Type it again' : 'Repeat it'}
            </label>
            <div className={styles.inputWrap}>
              <input id="su-again" className={`${styles.input} ${styles.padRightWide}`} type={show ? 'text' : 'password'} value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch || undefined} data-ok={(pass.length >= 8 && again === pass) || undefined} autoComplete="new-password" spellCheck={false} />
              {pass.length >= 8 && again === pass && (
                <span className={`${styles.inside} ${styles.insideNote} ${styles.ok}`}>
                  <CheckIcon />
                  Matches
                </span>
              )}
              {mismatch && <span className={`${styles.inside} ${styles.insideNote} ${styles.bad}`}>Does not match</span>}
            </div>
          </div>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={!passOk}>
              Next
            </button>
            <button type="button" className={styles.ghost} onClick={() => setScreen('callsign')}>
              Back
            </button>
          </div>
        </form>
      </Frame>
    )
  }

  if (screen === 'keyfile') {
    return (
      <Frame stepper={<Stepper current={2} />}>
        <form
          className={styles.col}
          onSubmit={(e) => {
            e.preventDefault()
            if (keyOk) setScreen('review')
          }}
        >
          <div className={styles.head}>
            <h1 className={styles.title}>Add a keyfile?</h1>
            <p className={styles.hint}>Optional. A file you keep apart from this computer, such as on a USB stick. With it, the passphrase alone will not open the vault.</p>
          </div>
          <div role="radiogroup" aria-label="How the vault is locked" className={styles.cards}>
            <label className={styles.card} data-on={!useKeyfile}>
              <input type="radio" name="lock" checked={!useKeyfile} onChange={() => setUseKeyfile(false)} />
              <span className={styles.badge} aria-hidden="true">
                <CheckIcon size={12} color="#fff" />
              </span>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <rect x="3" y="8" width="22" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="9" cy="14" r="1.4" fill="currentColor" />
                <circle cx="14" cy="14" r="1.4" fill="currentColor" />
                <circle cx="19" cy="14" r="1.4" fill="currentColor" />
              </svg>
              <span className={styles.cardTitle}>Passphrase only</span>
            </label>
            <label className={styles.card} data-on={useKeyfile}>
              <input type="radio" name="lock" checked={useKeyfile} onChange={() => setUseKeyfile(true)} />
              <span className={styles.badge} aria-hidden="true">
                <CheckIcon size={12} color="#fff" />
              </span>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <circle cx="9" cy="14" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M13.5 14H25M21 14v4M24.5 14v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className={styles.cardTitle}>Passphrase + keyfile</span>
            </label>
          </div>
          {useKeyfile && (
            <div className={styles.panel}>
              {keyfile && (
                <div className={styles.chip}>
                  <span className={styles.chipName}>
                    <span className={styles.ok}>
                      <CheckIcon size={16} />
                    </span>
                    {keyfile.split(/[\\/]/).pop()}
                  </span>
                  <button type="button" className={styles.linkBtn} onClick={() => setKeyfile(undefined)}>
                    Remove
                  </button>
                </div>
              )}
              <div className={styles.row}>
                <button type="button" className={styles.small} onClick={() => void chooseKeyfile(true)}>
                  Create new…
                </button>
                <button type="button" className={styles.small} onClick={() => void chooseKeyfile(false)}>
                  Use existing…
                </button>
              </div>
              <p className={styles.warn}>Lose the keyfile and the passphrase stops working. Your recovery key still will.</p>
            </div>
          )}
          {err && <div className={styles.error}>{err}</div>}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={!keyOk}>
              Next
            </button>
            <button type="button" className={styles.ghost} onClick={() => setScreen('passphrase')}>
              Back
            </button>
          </div>
        </form>
      </Frame>
    )
  }

  if (screen === 'sealing') {
    return (
      <Frame stepper={<Stepper current={4} busy />}>
        <div className={styles.col} role="status" aria-live="polite">
          <div className={styles.head}>
            <h1 className={styles.title}>Creating your vault</h1>
            <p className={styles.hint}>This takes a few seconds on purpose. It makes every guess at your passphrase slow and expensive.</p>
          </div>
          <ol className={styles.seal}>
            {STAGES.map((s, i) => {
              const state = i < stage ? 'done' : i === stage ? 'now' : 'todo'
              return (
                <li key={s.label} className={styles.sealItem} data-state={state}>
                  <span className={styles.sealIcon}>
                    {state === 'done' ? (
                      <span className={styles.ok}>
                        <CheckIcon size={16} />
                      </span>
                    ) : state === 'now' ? (
                      <svg className={styles.spin} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <circle cx="8" cy="8" r="6" stroke="var(--color-border)" strokeWidth="2" />
                        <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--color-accent-bright)" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <span className={styles.todoDot} />
                    )}
                  </span>
                  {s.label}
                  {s.tag && <span className={styles.sealTag}>{s.tag}</span>}
                </li>
              )
            })}
          </ol>
        </div>
      </Frame>
    )
  }

  // review
  return (
    <Frame stepper={<Stepper current={3} />}>
      <form
        className={styles.col}
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className={styles.head}>
          <h1 className={styles.title}>Check your choices</h1>
          <p className={styles.hint}>Creating the vault takes a few seconds.</p>
        </div>
        <div className={styles.rows}>
          <div className={styles.rowItem}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>Callsign</span>
              <span className={styles.rowValue}>{callsign.trim()}</span>
            </span>
            <button type="button" className={styles.linkBtn} style={{ fontSize: 14 }} onClick={() => setScreen('callsign')}>
              Edit
            </button>
          </div>
          <div className={styles.rowItem}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>Passphrase</span>
              <span className={styles.rowValue}>
                {'•'.repeat(Math.min(pass.length, 16))} <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: strength.score >= 3 ? 'var(--color-success)' : 'var(--color-warn)' }}>{strength.label[0].toUpperCase() + strength.label.slice(1)}</span>
              </span>
            </span>
            <button type="button" className={styles.linkBtn} style={{ fontSize: 14 }} onClick={() => setScreen('passphrase')}>
              Edit
            </button>
          </div>
          <div className={styles.rowItem}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>Keyfile</span>
              <span className={styles.rowValue}>{useKeyfile && keyfile ? keyfile.split(/[\\/]/).pop() : 'None'}</span>
            </span>
            <button type="button" className={styles.linkBtn} style={{ fontSize: 14 }} onClick={() => setScreen('keyfile')}>
              Edit
            </button>
          </div>
        </div>
        {err && <div className={styles.error}>{err}</div>}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} autoFocus>
            Create vault
          </button>
          <button type="button" className={styles.ghost} onClick={() => setScreen('keyfile')}>
            Back
          </button>
        </div>
      </form>
    </Frame>
  )
}
