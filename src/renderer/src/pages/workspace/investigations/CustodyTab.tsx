import { useEffect, useMemo, useState } from 'react'
import { Download, FileCheck2 } from 'lucide-react'
import Button from '@/components/Button'
import Panel from '@/components/Panel'
import type { JanusApi } from '@shared/api'
import { describeCounts } from '@shared/redact'
import { buildReceipt } from '@shared/receipt'
import { downloadText } from '@/lib/download'
import { useCaseAssessment } from './useAssessment'
import { namesIn, redactCaseFile, redactOptionsFrom } from '@shared/sharecopy'
import { MIN_PASSPHRASE_LENGTH } from './constants'
import { useCases } from './caseStore'
import { CaseLogPanel } from './panels'
import base from './Investigations.module.css'
import styles from './Platform.module.css'

export default function CustodyTab({ investigationId }: { investigationId: string }) {
  const cases = useCases()
  const api = (globalThis as unknown as { janus?: JanusApi }).janus
  const privacy = cases.settings.privacy
  const [redact, setRedact] = useState(privacy.redactOnShare)
  const [seal, setSeal] = useState(false)
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sign, setSign] = useState(true)
  const [fp, setFp] = useState<string | null>(null)
  useEffect(() => {
    if (cases.vault.mode === 'sealed' && !cases.vault.locked) void api?.vault?.identity?.().then((i) => setFp(i.fingerprint)).catch(() => setFp(null))
  }, [api, cases.vault.mode, cases.vault.locked])

  const view = useCaseAssessment(investigationId)
  const file = cases.buildCaseFile(investigationId)
  const preview = useMemo(() => {
    if (!file) return null
    const names = namesIn(file.evidence, file.investigation, cases.settings.agent)
    return redactCaseFile(file, redactOptionsFrom(privacy, names)).counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.evidence, file?.investigation, file?.report, privacy, cases.settings.agent])

  if (!file) return null
  const sealOk = !seal || (pass.length >= MIN_PASSPHRASE_LENGTH && pass === again)
  const log = cases.store.logs[investigationId] ?? []

  async function doExport() {
    if (!api || !file) return
    setBusy(true)
    setMsg(null)
    try {
      let out = file
      if (redact) {
        const names = namesIn(file.evidence, file.investigation, cases.settings.agent)
        out = redactCaseFile(file, redactOptionsFrom(privacy, names)).file
      }
      const saved = await api.investigations.exportCase(out, seal ? pass : undefined, !!fp && sign)
      if (saved) {
        cases.logAction(investigationId, 'case:export', `${redact ? 'redacted' : 'full'} copy${seal ? ', sealed with a passphrase' : ', not sealed'}${fp && sign ? `, signed ${fp}` : ', unsigned'}`)
        setMsg(`Saved. ${redact ? 'Identifying details were replaced.' : 'This copy contains names, addresses and paths exactly as filed.'}${seal ? ' It opens only with the passphrase.' : ''}`)
        setPass('')
        setAgain('')
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const counted = preview ? describeCounts(preview) : ''

  return (
    <div className={styles.stack}>
      <Panel title="Hand this case to another agent" icon={<Download size={18} strokeWidth={1.75} />}>
        <p className={base.muted}>
          A case file carries the evidence, the report and the case log. The other agent opens it in Janus and merges what you found with what they have; every seal is re-checked on their side, not trusted.
        </p>
        <div className={styles.exportOpts}>
          <label className={base.check}>
            <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} />
            <span>
              <b>Share-safe copy.</b> Replace email and IP addresses, MAC addresses, user folders, keys, phone numbers and the names of people and machines in this case with stable placeholders. Hashes and chain heads stay, so seals can still be checked.
            </span>
          </label>
          {redact && (
            <div className={base.note}>
              {counted ? `This copy will replace: ${counted}.` : 'Nothing in this case matches what is set to be replaced.'} A redacted copy cannot carry the case log (its hashes would no longer match); it records the log’s original head and length instead.
            </div>
          )}
          {!redact && counted && <div className={styles.error}>This case contains {counted}. An unredacted copy includes them.</div>}
          {fp ? (
            <label className={base.check}>
              <input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)} />
              <span>
                <b>Sign it as yourself.</b> The other agent’s Janus can show the file was not changed after you signed it. Your fingerprint is <code>{fp}</code>: read it to them by voice or show it in person, so they can trust that it is you.
              </span>
            </label>
          ) : (
            <div className={base.note}>Set up the vault (Privacy) to sign exports with your own identity.</div>
          )}
          <label className={base.check}>
            <input type="checkbox" checked={seal} onChange={(e) => setSeal(e.target.checked)} />
            <span>
              <b>Seal with a passphrase.</b> AES-256-GCM; the file is unreadable without it. Send the passphrase by a different route than the file.
            </span>
          </label>
          {seal && (
            <div className={base.row}>
              <input className={base.input} type="password" placeholder={`Passphrase (${MIN_PASSPHRASE_LENGTH}+ characters)`} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
              <input className={base.input} type="password" placeholder="Repeat it" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
            </div>
          )}
          {seal && pass && again && pass !== again && <div className={styles.error}>The two passphrases differ.</div>}
        </div>
        <div className={base.actions}>
          <Button onClick={() => void doExport()} disabled={!api || busy || !sealOk}>
            Export case file…
          </Button>
        </div>
        {msg && <div className={base.note}>{msg}</div>}
      </Panel>
      <Panel title="Verification receipt" icon={<FileCheck2 size={18} strokeWidth={1.75} />}>
        <p className={base.muted}>
          A plain-text record of what Janus checked in this case: each file’s SHA-256, whether its seal verified, the verdict and whether it is current, and the case log’s chain head. Someone without Janus can recompute the hashes from the original files and compare. It is not signed, so it shows what this computer computed, not who is vouching for it.
        </p>
        <div className={base.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              if (!view.inv) return
              const text = buildReceipt({ investigation: view.inv, evidence: view.assessment.graded, log, assessment: view.assessment, analysed: view.analysed, stale: view.stale, agent: cases.settings.agent, now: new Date().toISOString() })
              downloadText(`${view.inv.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'case'}.receipt.txt`, text)
              cases.logAction(investigationId, 'receipt:export', `${view.evidence.length} item${view.evidence.length === 1 ? '' : 's'}`)
            }}
          >
            Save verification receipt
          </Button>
        </div>
      </Panel>
      <CaseLogPanel log={log} />
    </div>
  )
}
