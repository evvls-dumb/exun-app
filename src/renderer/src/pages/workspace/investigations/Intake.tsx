import { useMemo, useRef, useState, type DragEvent } from 'react'
import { FilePlus2, FolderOpen, Lock, ShieldAlert, ShieldCheck, ShieldQuestion, X } from 'lucide-react'
import Button from '@/components/Button'
import type { JanusApi } from '@shared/api'
import { EVIDENCE_TYPE_LABELS, type Evidence, type EvidenceFactors, type EvidenceType, type Stance } from '@shared/evidence'
import type { IntakeBatch, IntakeItem } from '@shared/intake'
import type { Investigation } from '@shared/investigation'
import { judgeSigner } from '@shared/signers'
import { suggestForTelemetry, type TelemetryProfile } from '@shared/januslog'
import { suggestForLedger, type LedgerProfile } from '@shared/ledger'
import { newId, useCases } from './caseStore'
import styles from './Platform.module.css'
import base from './Investigations.module.css'

// The intake: drop everything you have on a case and Janus reads it, checks it, and tells you what it
// found before any of it becomes evidence. Nothing here is graded or concluded; this step is only
// "what is this, can it be trusted, and what does it say".

const KIND_LABEL: Record<IntakeItem['kind'], string> = {
  acquisition: 'Field-unit capture',
  telemetry: 'Cabinet telemetry',
  ledger: 'Meter ledger',
  diff: 'Game-code diff',
  readings: 'Sensor readings',
  narrative: 'Written account',
  'case-file': 'Case file',
  encrypted: 'Sealed file',
  file: 'Other file'
}

const KIND_TYPE: Record<IntakeItem['kind'], EvidenceType> = {
  acquisition: 'acquisition',
  telemetry: 'system_log',
  ledger: 'meter_log',
  diff: 'code_diff',
  readings: 'system_log',
  narrative: 'witness',
  'case-file': 'report',
  encrypted: 'other',
  file: 'other'
}

interface Decision {
  include: boolean
  title?: string
  type?: EvidenceType
  stance?: Stance
  strength?: 1 | 2 | 3
  firsthand?: boolean
  timestamped?: boolean
  note?: string
}

function bridge(): JanusApi | undefined {
  return (globalThis as unknown as { janus?: JanusApi }).janus
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

function suggestionFor(item: IntakeItem, inv: Investigation) {
  if (item.kind === 'telemetry' && item.profile) return suggestForTelemetry(item.profile as TelemetryProfile, inv.incident).suggestion
  if (item.kind === 'ledger' && item.profile) return suggestForLedger(item.profile as LedgerProfile, inv.incident)
  return null
}

export default function Intake({ investigation, existing, onCommitted }: { investigation: Investigation; existing: Evidence[]; onCommitted: () => void }) {
  const cases = useCases()
  const api = bridge()
  const [items, setItems] = useState<IntakeItem[]>([])
  const [skipped, setSkipped] = useState<IntakeBatch['skipped']>([])
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [handled, setHandled] = useState<Record<string, string>>({})
  const [pass, setPass] = useState<Record<string, string>>({})
  const [heads, setHeads] = useState<Record<string, string>>({})
  const batchNo = useRef(0)

  const known = useMemo(() => new Set(existing.map((e) => e.fileSha256).filter(Boolean)), [existing])

  function absorb(batch: IntakeBatch, replaceKey?: string) {
    const n = ++batchNo.current
    const remap = (k: string) => `${n}:${k}`
    const incoming = batch.items.map((i) => ({ ...i, key: remap(i.key), parent: i.parent ? remap(i.parent) : undefined }))
    setItems((cur) => [...(replaceKey ? cur.filter((i) => i.key !== replaceKey) : cur), ...incoming])
    setSkipped((cur) => [...cur, ...batch.skipped])
    setDecisions((cur) => {
      const next = { ...cur }
      for (const i of incoming) {
        const dup = !!i.sha256 && known.has(i.sha256) && i.kind !== 'case-file'
        next[i.key] = { include: !!i.draft && i.status !== 'error' && i.kind !== 'file' && !dup }
      }
      return next
    })
  }

  async function run(paths: string[]) {
    if (!api?.intake || paths.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      absorb(await api.intake.ingest(paths))
    } catch (e) {
      setErr(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  async function pick(what: 'files' | 'folder') {
    if (!api?.intake) return
    const paths = await api.intake.pick(what).catch(() => [])
    await run(paths)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    if (!api?.intake) return
    const paths = api.intake.pathsOf(Array.from(e.dataTransfer.files))
    if (paths.length === 0) setErr('Could not read the location of what was dropped. Use “Add files…” instead.')
    else void run(paths)
  }

  async function unlockItem(item: IntakeItem) {
    const p = pass[item.key]
    if (!api?.intake || !item.lockedPath || !p) return
    setBusy(true)
    setErr(null)
    try {
      const batch = await api.intake.ingest([item.lockedPath], p)
      const stillLocked = batch.items.length === 1 && batch.items[0].status === 'locked'
      if (stillLocked) setErr(batch.items[0].summary[0] ?? 'That passphrase does not open this file.')
      else absorb(batch, item.key)
    } catch (e) {
      setErr(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const dec = (key: string): Decision => decisions[key] ?? { include: false }
  const patch = (key: string, p: Partial<Decision>) => setDecisions((cur) => ({ ...cur, [key]: { ...dec(key), ...p } }))

  const chosen = items.filter((i) => dec(i.key).include && i.draft && i.status !== 'error')

  function effective(item: IntakeItem) {
    const d = dec(item.key)
    const sug = suggestionFor(item, investigation)
    const draft = item.draft!
    return {
      title: d.title ?? draft.title,
      type: d.type ?? draft.type ?? KIND_TYPE[item.kind],
      stance: d.stance ?? sug?.stance ?? draft.stance,
      strength: d.strength ?? sug?.strength ?? draft.strength,
      factors: { ...draft.factors, firsthand: d.firsthand ?? draft.factors.firsthand, timestamped: d.timestamped ?? draft.factors.timestamped } as EvidenceFactors,
      reason: sug?.reason
    }
  }

  function commit() {
    const now = new Date().toISOString()
    const out: Evidence[] = chosen.map((item) => {
      const e = effective(item)
      const d = dec(item.key)
      return {
        ...item.draft!,
        id: newId('e'),
        investigationId: investigation.id,
        agentId: cases.settings.agent,
        title: e.title.trim() || item.draft!.title,
        type: e.type,
        stance: e.stance,
        strength: e.strength,
        factors: e.factors,
        notes: [item.draft!.notes, d.note].filter(Boolean).join('\n'),
        addedAt: now,
        origin: item.draft!.origin ?? 'upload'
      }
    })
    const names = out.length === 1 ? out[0].title : `${out.length} items`
    cases.addEvidence(out, `Filed ${names} from intake`)
    setItems((cur) => cur.filter((i) => !chosen.includes(i)))
    onCommitted()
  }

  const roots = items.filter((i) => !i.parent || !items.some((p) => p.key === i.parent))
  const childrenOf = (k: string) => items.filter((i) => i.parent === k)

  function renderItem(item: IntakeItem, child = false) {
    const d = dec(item.key)
    const draft = item.draft
    const v = draft?.verification
    const dup = !!item.sha256 && known.has(item.sha256) && item.kind !== 'case-file'
    const tone = item.status === 'locked' ? 'locked' : v?.state === 'failed' ? 'bad' : v?.state === 'verified' ? 'good' : v?.state === 'unchecked' ? 'warn' : item.status === 'error' ? 'bad' : 'plain'
    const eff = draft ? effective(item) : null
    return (
      <div key={item.key} className={styles.card} data-child={child || undefined} data-tone={tone} data-off={(draft && !d.include) || undefined}>
        <div className={styles.cardHead}>
          {draft && item.status !== 'error' && (
            <input type="checkbox" className={styles.include} checked={d.include} onChange={(e) => patch(item.key, { include: e.target.checked })} aria-label={`Add ${item.name} to the case`} />
          )}
          <div className={styles.cardTitle}>
            <span className={styles.kind}>{KIND_LABEL[item.kind]}</span>
            <span className={styles.fname}>{item.name}</span>
          </div>
          <span className={styles.pill} data-tone={tone}>
            {item.status === 'locked' ? (
              <>
                <Lock size={12} /> SEALED
              </>
            ) : v?.state === 'verified' ? (
              <>
                <ShieldCheck size={12} /> VERIFIED BY JANUS
              </>
            ) : v?.state === 'failed' ? (
              <>
                <ShieldAlert size={12} /> SEAL BROKEN
              </>
            ) : v?.state === 'unchecked' ? (
              <>
                <ShieldQuestion size={12} /> UNVERIFIED CLAIM
              </>
            ) : item.status === 'error' ? (
              'UNREADABLE'
            ) : (
              'READ'
            )}
          </span>
        </div>

        <ul className={styles.lines}>
          {item.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          {dup && <li data-sev="medium">This exact file is already in the case; it is not added again unless you tick it.</li>}
          {!!item.seenIn?.length && <li>Also found, byte for byte, in {item.seenIn.length} other capture{item.seenIn.length === 1 ? '' : 's'}.</li>}
        </ul>
        {v && v.notes.length > 0 && (
          <ul className={styles.lines} data-verification>
            {v.notes.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
        {item.findings.length > 0 && (
          <div className={styles.findings}>
            {item.findings.map((f, i) => (
              <div key={i} className={styles.finding} data-sev={f.severity}>
                <b>{f.title}</b> <span>{f.detail}</span>
              </div>
            ))}
          </div>
        )}

        {item.status === 'locked' && (
          <div className={styles.inline}>
            <input
              className={base.input}
              type="password"
              placeholder="Passphrase for this file"
              value={pass[item.key] ?? ''}
              onChange={(e) => setPass((c) => ({ ...c, [item.key]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && void unlockItem(item)}
              autoComplete="off"
            />
            <Button variant="secondary" onClick={() => void unlockItem(item)} disabled={!pass[item.key] || busy}>
              Open
            </Button>
          </div>
        )}

        {item.kind === 'acquisition' && item.acquisition?.chainHead && (
          <div className={styles.headCheck}>
            <label className={base.label}>Chain head recorded elsewhere (optional: from the field unit’s screen, a printout, or the examiner)</label>
            <input className={base.input} style={{ fontFamily: 'var(--font-mono)', userSelect: 'text' }} placeholder="paste the 64-character head" value={heads[item.key] ?? ''} onChange={(e) => setHeads((c) => ({ ...c, [item.key]: e.target.value.trim() }))} spellCheck={false} />
            {heads[item.key] && (
              <div className={styles.match} data-ok={heads[item.key].toLowerCase() === item.acquisition.chainHead.toLowerCase() || undefined}>
                {heads[item.key].toLowerCase() === item.acquisition.chainHead.toLowerCase()
                  ? 'Matches the chain head recomputed from this capture.'
                  : 'Does NOT match. Either the copy you were given or the head you were told is not the one that was sealed.'}
              </div>
            )}
          </div>
        )}

        {item.kind === 'case-file' && item.caseFile && (
          <div className={styles.caseFile}>
            <div>
              <b>{item.caseFile.investigation.title}</b>
              <span className={base.muted}>
                {' '}
                · {item.caseFile.evidence.length} evidence · from {item.caseFile.exportedBy ?? 'unknown agent'}
                {item.caseFile.redaction ? ' · redacted copy' : ''}
              </span>
            </div>
            {(() => {
              const v = judgeSigner(item.signature, item.caseFile.exportedBy, cases.store.signers)
              const fp = item.signature?.fingerprint
              return (
                <div className={v.warn ? styles.error : base.note} data-signer={v.kind}>
                  <b>{v.headline}.</b> {v.detail}
                  {fp && item.signature?.state === 'valid' && v.kind !== 'trusted' && (
                    <div className={base.actions}>
                      <Button variant="secondary" onClick={() => cases.trustSigner(fp, item.caseFile!.exportedBy ?? item.signature?.signer ?? 'agent', true)}>
                        I compared the fingerprint with them: trust
                      </Button>
                    </div>
                  )}
                  {fp && v.kind === 'trusted' && (
                    <div className={base.actions}>
                      <Button variant="ghost" onClick={() => cases.trustSigner(fp, '', false)}>
                        Stop trusting this signer
                      </Button>
                    </div>
                  )}
                </div>
              )
            })()}
            {handled[item.key] ? (
              <div className={base.note}>{handled[item.key]}</div>
            ) : (
              <div className={base.actions}>
                <Button
                  variant="secondary"
                  disabled={item.signature?.state === 'invalid'}
                  onClick={() => {
                    if (item.signature?.state === 'valid' && item.signature.fingerprint) cases.noteSigner(item.signature.fingerprint, item.caseFile!.exportedBy ?? item.signature.signer ?? 'agent')
                    const r = cases.mergeFrom(investigation.id, item.caseFile!)
                    setHandled((c) => ({ ...c, [item.key]: `Merged into this case: ${r.added} added, ${r.duplicates} already present.` }))
                  }}
                >
                  Merge its evidence into this case
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (item.signature?.state === 'valid' && item.signature.fingerprint) cases.noteSigner(item.signature.fingerprint, item.caseFile!.exportedBy ?? item.signature.signer ?? 'agent')
                    cases.openAsNew(item.caseFile!)
                    setHandled((c) => ({ ...c, [item.key]: 'Opened as a separate investigation.' }))
                  }}
                >
                  Open as separate investigation
                </Button>
              </div>
            )}
          </div>
        )}

        {item.kind === 'file' && <div className={styles.hint}>Filed and hashed, but Janus does not interpret this kind of file. To bring code changes into the case, add a diff of them; to bring in an account, add it as a document.</div>}

        {draft && d.include && eff && (
          <div className={styles.controls}>
            <div className={base.field} style={{ gridColumn: '1 / -1' }}>
              <label className={base.label}>Title</label>
              <input className={base.input} value={eff.title} onChange={(e) => patch(item.key, { title: e.target.value })} />
            </div>
            <div className={base.field}>
              <label className={base.label}>Type</label>
              <select className={base.select} value={eff.type} onChange={(e) => patch(item.key, { type: e.target.value as EvidenceType })}>
                {(Object.keys(EVIDENCE_TYPE_LABELS) as EvidenceType[]).map((t) => (
                  <option key={t} value={t}>
                    {EVIDENCE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className={base.field}>
              <label className={base.label}>Bears on the hypothesis</label>
              <select className={base.select} value={eff.stance} onChange={(e) => patch(item.key, { stance: e.target.value as Stance })}>
                <option value="supports">supports</option>
                <option value="refutes">refutes</option>
                <option value="neutral">neutral</option>
              </select>
            </div>
            <div className={base.field}>
              <label className={base.label}>Strength</label>
              <select className={base.select} value={eff.strength} onChange={(e) => patch(item.key, { strength: Number(e.target.value) as 1 | 2 | 3 })}>
                <option value={1}>1 · weak</option>
                <option value={2}>2 · moderate</option>
                <option value={3}>3 · strong</option>
              </select>
            </div>
            <div className={base.field}>
              <label className={base.label}>Reliability</label>
              <div className={base.checks}>
                <span className={styles.fixed} data-on={eff.factors.sealed || undefined} title="Set only when Janus recomputes the seal itself">
                  {eff.factors.sealed ? '⬡ sealed' : '○ not sealed'}
                </span>
                <span className={styles.fixed} data-on={eff.factors.custody || undefined} title="Comes from a field-unit acquisition that verified">
                  {eff.factors.custody ? '⬡ custody' : '○ no custody'}
                </span>
                <label className={base.check}>
                  <input type="checkbox" checked={eff.factors.firsthand} onChange={(e) => patch(item.key, { firsthand: e.target.checked })} />
                  Firsthand
                </label>
                <label className={base.check}>
                  <input type="checkbox" checked={eff.factors.timestamped} onChange={(e) => patch(item.key, { timestamped: e.target.checked })} />
                  Timestamped
                </label>
              </div>
            </div>
            {eff.reason && <div className={styles.reason}>{eff.reason}</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.intake}>
      {!api?.intake ? (
        <div className={base.note}>File intake needs the Janus desktop app, which can read files and folders from this computer.</div>
      ) : (
        <div
          className={styles.drop}
          data-over={over || undefined}
          data-busy={busy || undefined}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <div className={styles.dropTitle}>{busy ? 'Reading, hashing and verifying…' : 'Drop everything you have on this case'}</div>
          <p className={styles.dropText}>
            Field-unit folders and packs (<code>.tar.gz</code>), <code>logs.janus</code>, meter ledgers, code diffs, witness statements, other agents’ case files, and sealed (<code>.janus-enc</code>) files. Janus reads them
            in place, never alters them, and checks every seal itself.
          </p>
          <div className={base.actions} style={{ justifyContent: 'center' }}>
            <Button onClick={() => void pick('files')} disabled={busy}>
              <FilePlus2 size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Add files…
            </Button>
            <Button variant="secondary" onClick={() => void pick('folder')} disabled={busy}>
              <FolderOpen size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Add folder…
            </Button>
          </div>
        </div>
      )}

      {err && <div className={styles.error}>{err}</div>}

      {items.length > 0 && (
        <>
          <div className={styles.reviewHead}>
            <div>
              <div className={styles.reviewTitle}>Review before filing</div>
              <div className={base.muted}>Nothing has been added to the case yet. Untick what does not belong; adjust what each item says about the hypothesis.</div>
            </div>
            <Button variant="ghost" onClick={() => { setItems([]); setSkipped([]); setDecisions({}) }}>
              <X size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} /> Clear
            </Button>
          </div>
          <div className={styles.cards}>
            {roots.map((r) => (
              <div key={r.key} className={styles.group}>
                {renderItem(r)}
                {childrenOf(r.key).map((c) => renderItem(c, true))}
              </div>
            ))}
          </div>
          {skipped.length > 0 && (
            <details className={styles.skipped}>
              <summary>{skipped.length} not read</summary>
              <ul>
                {skipped.map((s, i) => (
                  <li key={i}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{s.name}</span>, {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className={styles.commit}>
            <span className={base.muted}>
              {chosen.length} {chosen.length === 1 ? 'item' : 'items'} selected
              {chosen.some((c) => c.draft?.verification?.state === 'unchecked') ? ' · includes unverified claims (they are filed as claims, not as proof)' : ''}
            </span>
            <Button onClick={commit} disabled={chosen.length === 0}>
              File {chosen.length || ''} {chosen.length === 1 ? 'item' : 'items'} as evidence
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
