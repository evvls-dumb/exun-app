import { useEffect, useMemo, useState } from 'react'
import { Archive, EyeOff, Fingerprint, KeyRound, Lock, ShieldCheck, UserRound } from 'lucide-react'
import Button from '@/components/Button'
import Panel from '@/components/Panel'
import type { AgentIdentity, JanusApi, SecurityLog } from '@shared/api'
import type { AiCaseAccess, PlatformSettings } from '@shared/investigation'
import { WIPE_CHOICES, type Prefs } from '@shared/prefs'
import { passphraseStrength } from '@shared/passphrase'
import RecoveryKeyCard from '@/pages/login/RecoveryKeyCard'
import { describeCounts, Redactor, REDACT_KIND_LABELS, scanForIdentifiers, type RedactKind } from '@shared/redact'
import { redactOptionsFrom } from '@shared/sharecopy'
import { useCases } from '../investigations/caseStore'
import { MIN_PASSPHRASE_LENGTH } from '../investigations/constants'
import VaultGate from '../investigations/VaultGate'
import base from '../investigations/Investigations.module.css'
import styles from '../investigations/Platform.module.css'

const AI_OPTIONS: { id: AiCaseAccess; label: string; text: string }[] = [
  { id: 'off', label: 'Off', text: 'The assistant cannot read your cases at all. It still works on the meter log you opened. This is the default.' },
  { id: 'redacted', label: 'Redacted', text: 'The assistant sees grades, findings and discrepancies, with addresses, user folders, keys, phone numbers and the names of people and machines replaced by placeholders before anything is sent.' },
  { id: 'full', label: 'Full', text: 'The assistant sees case contents exactly as filed. Use only if you are comfortable with that text going to the model provider.' }
]

const KIND_ORDER: Exclude<RedactKind, 'listed'>[] = ['email', 'ip', 'mac', 'path', 'secret', 'phone']

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

export default function PrivacyPage() {
  const cases = useCases()
  const api = (globalThis as unknown as { janus?: JanusApi }).janus
  if (cases.state === 'locked') return <VaultGate />
  if (cases.state !== 'ready') return <div className={styles.center}>Opening the case vault…</div>
  const s = cases.settings
  return (
    <div className={styles.privacy}>
      <VaultPanel hasApi={!!api?.vault} />
      {cases.vault.mode === 'sealed' && api?.vault?.securityLog && <SecurityPanel />}
      {cases.vault.mode === 'sealed' && api?.vault?.backup && <BackupPanel />}
      <AiPanel />
      <SharePanel settings={s} />
      <IdentityPanel />
      <LeavesPanel />
    </div>
  )
}

function VaultPanel({ hasApi }: { hasApi: boolean }) {
  const cases = useCases()
  const api = (globalThis as unknown as { janus?: JanusApi }).janus
  const [mode, setMode] = useState<null | 'change' | 'recovery' | 'destroy'>(null)
  const [cur, setCur] = useState('')
  const [curKey, setCurKey] = useState<string | undefined>()
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [nextKey, setNextKey] = useState<string | undefined>()
  const [phrase, setPhrase] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const needsKeyfile = cases.vault.keyfile
  const strength = passphraseStrength(pass)
  const ok = pass.length >= MIN_PASSPHRASE_LENGTH && pass === again

  function reset() {
    setCur('')
    setCurKey(undefined)
    setPass('')
    setAgain('')
    setNextKey(undefined)
    setPhrase('')
    setMode(null)
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await fn()
      setMsg(done)
      reset()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const keyfileRow = (path: string | undefined, set: (p: string | undefined) => void, label: string, allowCreate: boolean) => (
    <div className={base.actions}>
      {allowCreate && (
        <Button variant="secondary" onClick={async () => { const p = await api?.vault.createKeyfile(); if (p) set(p) }}>
          Create keyfile…
        </Button>
      )}
      <Button variant="secondary" onClick={async () => { const p = await api?.vault.pickKeyfile(); if (p) set(p) }}>
        {label}
      </Button>
      {path && <span className={base.muted} style={{ alignSelf: 'center' }}>{path.split(/[\\/]/).pop()}</span>}
    </div>
  )

  return (
    <Panel title="Case vault" icon={<Lock size={18} strokeWidth={1.75} />}>
      <div className={styles.vaultState} data-sealed>
        <ShieldCheck size={16} />
        <b>Sealed</b>
        <span className={base.muted}>
          Cases are encrypted on disk with AES-256-GCM under a random data key. That key is wrapped by your passphrase (stretched with scrypt, 128 MiB per guess){needsKeyfile ? ' and your keyfile' : ''}, and separately by your recovery key. It exists in memory only while unlocked.
        </span>
      </div>
      <div className={styles.factors}>
        <span data-on>passphrase</span>
        <span data-on={needsKeyfile || undefined}>keyfile {needsKeyfile ? 'required' : 'not used'}</span>
        <span data-on>recovery key</span>
      </div>
      {!hasApi && <div className={base.note}>The vault is a feature of the desktop app.</div>}

      {hasApi && (
        <div className={styles.stack}>
          <div className={base.actions}>
            <Button variant="secondary" onClick={() => void cases.lockNow()}>
              <Lock size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Lock now
            </Button>
            <Button variant="secondary" onClick={() => setMode(mode === 'change' ? null : 'change')}>
              Change passphrase or keyfile
            </Button>
            <Button variant="secondary" onClick={() => setMode(mode === 'recovery' ? null : 'recovery')}>
              New recovery key
            </Button>
            <Button variant="ghost" onClick={() => setMode(mode === 'destroy' ? null : 'destroy')}>
              Destroy vault…
            </Button>
          </div>

          {mode && mode !== 'destroy' && (
            <div className={styles.stack}>
              <div className={base.muted}>Confirm it is you:</div>
              <input className={base.input} type="password" placeholder="Current passphrase" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
              {needsKeyfile && keyfileRow(curKey, setCurKey, 'Choose current keyfile…', false)}
            </div>
          )}

          {mode === 'change' && (
            <div className={styles.stack}>
              <div className={base.row}>
                <input className={base.input} type="password" placeholder={`New passphrase (${MIN_PASSPHRASE_LENGTH}+)`} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
                <input className={base.input} type="password" placeholder="Repeat it" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
              </div>
              {pass && <div className={base.muted}>Strength: {strength.label} (~{strength.bits} bits). {strength.hint}</div>}
              <div className={base.muted}>Keyfile for the new credentials (optional):</div>
              {keyfileRow(nextKey, setNextKey, 'Use existing…', true)}
              <div className={base.actions}>
                <Button
                  disabled={!ok || !cur || busy || (needsKeyfile && !curKey)}
                  onClick={() => void run(() => api!.vault.change({ passphrase: cur, keyfilePath: curKey }, { passphrase: pass, keyfilePath: nextKey }), 'Credentials changed. Your recovery key still works.')}
                >
                  Change
                </Button>
              </div>
            </div>
          )}

          {mode === 'recovery' && (
            <div className={base.actions}>
              <Button
                disabled={!cur || busy || (needsKeyfile && !curKey)}
                onClick={() =>
                  void run(async () => {
                    const r = await api!.vault.newRecovery({ passphrase: cur, keyfilePath: curKey })
                    setNewKey(r.recoveryKey ?? null)
                  }, 'New recovery key made. The old one no longer works.')
                }
              >
                Make a new recovery key
              </Button>
            </div>
          )}

          {mode === 'destroy' && (
            <div className={styles.stack}>
              <div className={styles.error}>
                This erases the encryption keys and the vault file. Every case on this computer becomes unreadable to anyone, including you, even from a backup of the sealed file. It cannot be undone. Export anything you need first.
              </div>
              <input className={base.input} placeholder="Type DESTROY to confirm" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
              <div className={base.actions}>
                <Button variant="secondary" disabled={phrase !== 'DESTROY' || busy} onClick={() => void run(() => api!.vault.destroy(phrase), 'Vault destroyed.')}>
                  Destroy everything
                </Button>
              </div>
            </div>
          )}

          <div className={base.field} style={{ maxWidth: 320 }}>
            <label className={base.label}>Lock automatically after</label>
            <select className={base.select} value={cases.settings.privacy.autoLockMinutes} onChange={(e) => cases.updateSettings((s) => ({ ...s, privacy: { ...s.privacy, autoLockMinutes: Number(e.target.value) } }))}>
              {[1, 5, 15, 30, 60, 0].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'Never (until I lock it)' : `${m} minute${m === 1 ? '' : 's'} of inactivity`}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {newKey && (
        <div className={styles.recoveryBox}>
          <RecoveryKeyCard recoveryKey={newKey} onDone={() => setNewKey(null)} doneLabel="Done" />
        </div>
      )}
      {msg && <div className={base.note}>{msg}</div>}
      {err && <div className={styles.error}>{err}</div>}
    </Panel>
  )
}

const EVENT_LABEL: Record<string, string> = {
  'vault:setup': 'Vault created',
  'unlock:ok': 'Unlocked',
  'unlock:fail': 'Wrong attempt',
  lock: 'Locked',
  'credentials:change': 'Passphrase or keyfile changed',
  'recovery:new': 'New recovery key issued',
  'backup:restore': 'Restored from a backup',
  'identity:create': 'Signing identity created',
  'vault:wiped': 'Vault erased automatically'
}

function SecurityPanel() {
  const api = (globalThis as unknown as { janus?: JanusApi }).janus
  const cases = useCases()
  const [log, setLog] = useState<SecurityLog | null>(null)
  const [id, setId] = useState<AgentIdentity | null>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    if (cases.vault.locked) return
    void api?.vault.securityLog().then(setLog).catch(() => setLog(null))
    void api?.vault.identity().then(setId).catch(() => setId(null))
    void api?.prefs?.get().then(setPrefs)
  }, [api, cases.vault.locked, cases.vault.failed])
  const rows = log ? [...log.entries].reverse() : []
  const wrong = log?.entries.filter((e) => e.event === 'unlock:fail').length ?? 0
  return (
    <Panel title="Security" icon={<Fingerprint size={18} strokeWidth={1.75} />}>
      {id && (
        <div className={styles.stack}>
          <div>
            <div className={base.label}>Your signing fingerprint</div>
            <code data-testid="fingerprint" style={{ userSelect: 'text', fontSize: 15, letterSpacing: '0.04em' }}>{id.fingerprint}</code>
            <p className={base.muted}>
              Case files you export can be signed with a key that never leaves the vault. Give another agent this fingerprint by voice or in person; their Janus then knows a file really came from you and was not changed on the way. It does not hide who you are: it is a name for your key.
            </p>
          </div>
        </div>
      )}
      {prefs && (
        <div className={styles.stack}>
          <label className={base.label} htmlFor="wipe-after">Erase the vault after repeated wrong passphrases</label>
          <select
            id="wipe-after"
            className={base.select}
            value={prefs.wipeAfterFailures}
            onChange={async (e) => setPrefs(await api!.prefs.set({ wipeAfterFailures: Number(e.target.value) as Prefs['wipeAfterFailures'] }))}
          >
            {WIPE_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Never (recommended unless you carry the device through risky places)' : `After ${n} wrong attempts in a row`}
              </option>
            ))}
          </select>
          {prefs.wipeAfterFailures > 0 && (
            <div className={styles.error}>
              After {prefs.wipeAfterFailures} wrong attempts in a row the vault and its keys are deleted for good. Only a backup can bring it back, so keep one. Anyone at your keyboard can also trigger this on purpose. It does not stop someone who copied the files and guesses offline, because they never go through Janus.
            </div>
          )}
        </div>
      )}
      <div className={styles.stack}>
        <div className={base.label}>Security log {log && (log.intact ? <span style={{ color: 'var(--color-success)' }}> · chain intact</span> : <span style={{ color: 'var(--color-danger)' }}> · CHAIN BROKEN at entry {log.brokenAt}</span>)}</div>
        <p className={base.muted}>
          {wrong > 0 ? `${wrong} wrong attempt${wrong === 1 ? '' : 's'} recorded. ` : ''}
          Each entry is linked to the one before, so an edit in the middle shows up. Someone with your disk can still delete the whole file, so a missing log is itself worth noticing.
          {log?.earlierDropped ? ' Older entries were dropped to keep it short.' : ''}
        </p>
        {rows.length === 0 ? (
          <p className={base.empty}>Nothing recorded yet.</p>
        ) : (
          <ul className={styles.ledgerList} data-testid="security-log">
            {(all ? rows : rows.slice(0, 8)).map((e) => (
              <li key={e.seq} data-warn={e.event === 'unlock:fail' || e.event === 'vault:wiped' || undefined}>
                <b>{EVENT_LABEL[e.event] ?? e.event}</b>
                {e.detail ? ` · ${e.detail}` : ''}
                <span className={base.muted}> · {new Date(e.time).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 8 && (
          <button type="button" className={styles.linkBtn} onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </Panel>
  )
}

function BackupPanel() {
  const api = (globalThis as unknown as { janus?: JanusApi }).janus
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<string | null>) {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      setMsg(await fn())
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="Backup and restore" icon={<Archive size={18} strokeWidth={1.75} />}>
      <p className={base.muted}>
        A backup is the encrypted vault plus the file that wraps its key. It is as safe to store as the vault itself and opens only with the passphrase (and keyfile) it had when the backup was made, or its recovery key. Keep a copy somewhere other than this computer. Without one, a failed disk takes your cases with it.
      </p>
      <div className={base.actions}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run(async () => ((await api!.vault.backup()) ? 'Backup saved.' : null))}
        >
          Save an encrypted backup…
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setRestoring((v) => !v)}>
          Restore from a backup…
        </Button>
      </div>
      {restoring && (
        <div className={styles.stack}>
          <div className={styles.error}>Restoring replaces every case on this computer with the backup’s. Save a backup of the current vault first if you might want it. Afterwards the vault is locked and opens with the backup’s credentials, not today’s.</div>
          <input className={base.input} placeholder="Type RESTORE to confirm" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
          <div className={base.actions}>
            <Button
              variant="secondary"
              disabled={phrase !== 'RESTORE' || busy}
              onClick={() =>
                void run(async () => {
                  const s = await api!.vault.restore(phrase)
                  setPhrase('')
                  setRestoring(false)
                  return s ? 'Restored. Unlock with the backup’s passphrase.' : null
                })
              }
            >
              Choose a backup file…
            </Button>
          </div>
        </div>
      )}
      {msg && <div className={base.note}>{msg}</div>}
      {err && <div className={styles.error}>{err}</div>}
    </Panel>
  )
}

function AiPanel() {
  const cases = useCases()
  const current = cases.settings.privacy.aiCaseAccess
  return (
    <Panel title="AI access to your cases" icon={<KeyRound size={18} strokeWidth={1.75} />}>
      <p className={base.muted}>
        The AI assistant is a third-party model reached over the internet. Whether it may read your cases is your decision, and the default is no.
      </p>
      <div className={styles.radios} role="radiogroup" aria-label="AI access to cases">
        {AI_OPTIONS.map((o) => (
          <label key={o.id} className={styles.radio} data-on={current === o.id || undefined}>
            <input
              type="radio"
              name="ai-access"
              checked={current === o.id}
              onChange={() => cases.updateSettings((s) => ({ ...s, privacy: { ...s.privacy, aiCaseAccess: o.id } }))}
            />
            <span>
              <b>{o.label}</b>
              <span className={base.muted}>{o.text}</span>
            </span>
          </label>
        ))}
      </div>
    </Panel>
  )
}

function SharePanel({ settings }: { settings: PlatformSettings }) {
  const cases = useCases()
  const p = settings.privacy
  const [sample, setSample] = useState('Seen from 10.0.4.17 (b8:27:eb:12:34:56) by ravi@example.com; saved to C:\\Users\\mira\\Desktop\\notes.txt')
  const found = useMemo(() => scanForIdentifiers(JSON.stringify(cases.store.evidence) + JSON.stringify(cases.store.reports)), [cases.store.evidence, cases.store.reports])
  const out = useMemo(() => {
    const r = new Redactor(redactOptionsFrom(p, []))
    return r.apply(sample)
  }, [p, sample])
  const counted = describeCounts(found)
  return (
    <Panel title="Sharing and redaction" icon={<EyeOff size={18} strokeWidth={1.75} />}>
      <label className={base.check}>
        <input type="checkbox" checked={p.redactOnShare} onChange={(e) => cases.updateSettings((s) => ({ ...s, privacy: { ...s.privacy, redactOnShare: e.target.checked } }))} />
        <span>Make exports share-safe by default</span>
      </label>
      <div className={base.checks}>
        {KIND_ORDER.map((k) => (
          <label className={base.check} key={k}>
            <input
              type="checkbox"
              checked={p.redactKinds[k]}
              onChange={(e) => cases.updateSettings((s) => ({ ...s, privacy: { ...s.privacy, redactKinds: { ...s.privacy.redactKinds, [k]: e.target.checked } } }))}
            />
            {REDACT_KIND_LABELS[k]}
          </label>
        ))}
      </div>
      <p className={base.muted}>
        Names of people and machines recorded in a case (the examiner, hosts, agents) are always replaced in a share-safe copy. Hashes and chain heads are never touched: a recipient needs them to check the seals.
      </p>
      <div className={base.field}>
        <label className={base.label}>Try it on a sample</label>
        <textarea className={base.textarea} style={{ minHeight: 58, userSelect: 'text' }} value={sample} onChange={(e) => setSample(e.target.value)} spellCheck={false} />
        <div className={styles.preview}>{out}</div>
      </div>
      <div className={base.note}>{counted ? `Your cases currently contain ${counted}.` : 'Your cases currently contain none of the details above.'}</div>
    </Panel>
  )
}

function IdentityPanel() {
  const cases = useCases()
  const [name, setName] = useState(cases.settings.agent)
  const commit = () => {
    const v = name.trim().slice(0, 40)
    if (v && v !== cases.settings.agent) cases.updateSettings((s) => ({ ...s, agent: v }))
    else setName(cases.settings.agent)
  }
  return (
    <Panel title="Your callsign" icon={<UserRound size={18} strokeWidth={1.75} />}>
      <p className={base.muted}>
        This is the name evidence, log entries and exported case files are signed with. Use a callsign, not your legal name; it is the only identity Janus records. There are no accounts and nothing is sent anywhere to register it.
      </p>
      <div className={base.field} style={{ maxWidth: 320 }}>
        <input className={base.input} value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} maxLength={40} aria-label="Callsign" />
      </div>
    </Panel>
  )
}

function LeavesPanel() {
  const cases = useCases()
  const access = cases.settings.privacy.aiCaseAccess
  return (
    <Panel title="What leaves this machine" icon={<ShieldCheck size={18} strokeWidth={1.75} />}>
      <ul className={styles.ledgerList}>
        <li data-ok>
          <b>Files you drop in.</b> Read in place, hashed and analysed locally. Never uploaded, never modified.
        </li>
        <li data-ok>
          <b>Cases, evidence and reports.</b> Stored on this computer only{cases.vault.mode === 'sealed' ? ', encrypted' : ''}. There is no sync service, no account and no telemetry.
        </li>
        <li data-ok>
          <b>Case files you export.</b> Go where you put them, in the form you chose (share-safe, sealed, or both).
        </li>
        <li data-warn>
          <b>The AI assistant.</b> Your messages and what the assistant’s tools read from the meter log are sent to the model provider (Groq) with your own API key, which is stored encrypted by the operating system. Case contents are{' '}
          {access === 'off' ? 'not included' : access === 'redacted' ? 'included in redacted form' : 'included as filed'} (setting above).
        </li>
      </ul>
    </Panel>
  )
}
