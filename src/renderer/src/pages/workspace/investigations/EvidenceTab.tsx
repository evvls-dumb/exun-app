import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import Button from '@/components/Button'
import Panel from '@/components/Panel'
import { filterEvidence, isFiltered, NO_FILTER, sortEvidence, type EvidenceFilter, type EvidenceSort } from '@shared/evidenceView'
import { EVIDENCE_TYPE_LABELS, type Evidence, type EvidenceFactors, type EvidenceType, type GradedEvidence, type Stance } from '@shared/evidence'
import { newId, useCases } from './caseStore'
import base from './Investigations.module.css'
import styles from './Platform.module.css'

const FACTOR_LABELS: readonly [keyof EvidenceFactors, string][] = [
  ['sealed', 'Sealed / hash-verified'],
  ['custody', 'Chain of custody'],
  ['firsthand', 'Firsthand'],
  ['timestamped', 'Timestamped']
]

export default function EvidenceTab({ investigationId, graded }: { investigationId: string; graded: GradedEvidence[] }) {
  const cases = useCases()
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [filter, setFilter] = useState<EvidenceFilter>(NO_FILTER)
  const [sort, setSort] = useState<EvidenceSort>('added')
  const shown = sortEvidence(filterEvidence(graded, filter), sort)
  const agents = [...new Set(graded.map((e) => e.agentId))].sort()
  const set = <K extends keyof EvidenceFilter>(k: K, v: EvidenceFilter[K]) => setFilter((f) => ({ ...f, [k]: v }))

  return (
    <Panel title={`Evidence on file (${graded.length})`}>
      <div className={base.actions}>
        <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Record by hand
        </Button>
      </div>
      {adding && <ManualForm investigationId={investigationId} onDone={() => setAdding(false)} />}
      {graded.length > 1 && (
        <>
          <div className={styles.filters} role="search" aria-label="Filter evidence">
            <input className={base.input} type="search" placeholder="Filter by title, source, notes…" aria-label="Filter text" value={filter.text} onChange={(e) => set('text', e.target.value)} />
            <select className={base.select} aria-label="Type" value={filter.type} onChange={(e) => set('type', e.target.value as EvidenceFilter['type'])}>
              <option value="all">Any type</option>
              {(Object.keys(EVIDENCE_TYPE_LABELS) as EvidenceType[]).map((t) => (
                <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <select className={base.select} aria-label="Stance" value={filter.stance} onChange={(e) => set('stance', e.target.value as EvidenceFilter['stance'])}>
              <option value="all">Any stance</option>
              <option value="supports">Supports</option>
              <option value="refutes">Refutes</option>
              <option value="neutral">Neutral</option>
            </select>
            <select className={base.select} aria-label="Grade" value={filter.grade} onChange={(e) => set('grade', e.target.value as EvidenceFilter['grade'])}>
              <option value="all">Any grade</option>
              {(['A', 'B', 'C', 'D', 'E', 'F'] as const).map((g) => (
                <option key={g} value={g}>Grade {g}</option>
              ))}
            </select>
            <select className={base.select} aria-label="Seal" value={filter.seal} onChange={(e) => set('seal', e.target.value as EvidenceFilter['seal'])}>
              <option value="all">Any seal state</option>
              <option value="verified">Seal verified</option>
              <option value="claim">Unverified claim</option>
              <option value="broken">Seal broken</option>
              <option value="none">No seal</option>
            </select>
            {agents.length > 1 && (
              <select className={base.select} aria-label="Agent" value={filter.agent} onChange={(e) => set('agent', e.target.value)}>
                <option value="all">Any agent</option>
                {agents.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}
            <select className={base.select} aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as EvidenceSort)}>
              <option value="added">Newest filed first</option>
              <option value="grade">Most reliable first</option>
              <option value="time">By event time</option>
              <option value="title">By title</option>
            </select>
          </div>
          {isFiltered(filter) && (
            <div className={styles.filterNote}>
              <span>Showing {shown.length} of {graded.length}. The verdict still weighs all {graded.length}.</span>
              <button type="button" className={styles.linkBtn} onClick={() => setFilter(NO_FILTER)}>Clear filters</button>
            </div>
          )}
        </>
      )}
      {graded.length === 0 ? (
        <p className={base.empty}>Nothing filed yet. Use the Intake tab to drop in what you have.</p>
      ) : (
        <div>
          {shown.length === 0 && <p className={base.empty}>No evidence matches these filters.</p>}
          {shown.map((item) => {
            const isOpen = open === item.id
            const v = item.verification
            const digitalFromUpload = item.origin === 'upload' || item.origin === 'fieldunit' || item.origin === 'merge'
            return (
              <div key={item.id} className={styles.evBlock}>
                <button type="button" className={styles.evHead} onClick={() => setOpen(isOpen ? null : item.id)} aria-expanded={isOpen}>
                  <span className={`${base.grade} ${base[`g${item.grade}` as keyof typeof base]}`}>{item.grade}</span>
                  <div className={base.evMain}>
                    <span className={base.evTitle}>{item.title}</span>
                    <span className={base.evSub}>
                      {EVIDENCE_TYPE_LABELS[item.type].toUpperCase()} · {item.agentId.toUpperCase()} ·{' '}
                      {v?.state === 'verified' ? <span className={base.seal}>⬡ SEAL VERIFIED</span> : v?.state === 'failed' ? <span style={{ color: 'var(--color-danger)' }}>SEAL BROKEN</span> : v?.state === 'unchecked' ? 'UNVERIFIED CLAIM' : item.factors.sealed ? 'SEALED' : 'UNSEALED'}
                    </span>
                  </div>
                  {item.stance !== 'neutral' && (
                    <span className={base.stance} data-stance={item.stance}>
                      {item.stance.toUpperCase()}
                    </span>
                  )}
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {isOpen && (
                  <div className={styles.evBody}>
                    {item.fileName && (
                      <div className={styles.kv}>
                        <span>File</span>
                        <span style={{ userSelect: 'text' }}>
                          {item.fileName}
                          {item.fileSha256 && <> · sha256 {item.fileSha256.slice(0, 20)}…</>}
                        </span>
                      </div>
                    )}
                    {item.chainHead && (
                      <div className={styles.kv}>
                        <span>Chain head</span>
                        <span style={{ userSelect: 'text', wordBreak: 'break-all' }}>{item.chainHead}</span>
                      </div>
                    )}
                    {item.facts?.coverage && (
                      <div className={styles.kv}>
                        <span>Covers</span>
                        <span>
                          {item.facts.coverage.from.slice(0, 10)} → {item.facts.coverage.to.slice(0, 10)}
                        </span>
                      </div>
                    )}
                    {item.facts?.declaredOrigin && (
                      <div className={styles.kv}>
                        <span>Declares itself</span>
                        <span>{item.facts.declaredOrigin}</span>
                      </div>
                    )}
                    {item.facts?.modeled && item.facts.modeled.length > 0 && (
                      <div className={styles.kv}>
                        <span>Modeled, not measured</span>
                        <span>{item.facts.modeled.join(', ')}</span>
                      </div>
                    )}
                    {item.facts?.unmeasured && item.facts.unmeasured.length > 0 && (
                      <div className={styles.kv}>
                        <span>Never measured</span>
                        <span>{item.facts.unmeasured.join(', ')}</span>
                      </div>
                    )}
                    {v && v.notes.length > 0 && (
                      <ul className={styles.lines} data-verification>
                        {v.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    )}
                    {item.findings && item.findings.length > 0 && (
                      <div className={styles.findings}>
                        {item.findings.map((f, i) => (
                          <div key={i} className={styles.finding} data-sev={f.severity}>
                            <b>{f.title}</b> <span>{f.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.breakdown}>
                      <span className={base.label}>Why grade {item.grade} ({item.score}/100)</span>
                      <div className={styles.factorRow}>
                        {item.breakdown.map((f) => (
                          <span key={f.label} className={styles.factor} data-on={f.on || undefined}>
                            {f.on ? '+' : '·'}
                            {f.points} {f.label}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className={styles.controls}>
                      <div className={base.field}>
                        <label className={base.label}>Bears on the hypothesis</label>
                        <select className={base.select} value={item.stance} onChange={(e) => cases.updateEvidence(item.id, { stance: e.target.value as Stance })}>
                          <option value="supports">supports</option>
                          <option value="refutes">refutes</option>
                          <option value="neutral">neutral</option>
                        </select>
                      </div>
                      <div className={base.field}>
                        <label className={base.label}>Strength</label>
                        <select className={base.select} value={item.strength} onChange={(e) => cases.updateEvidence(item.id, { strength: Number(e.target.value) as 1 | 2 | 3 })}>
                          <option value={1}>1 · weak</option>
                          <option value={2}>2 · moderate</option>
                          <option value={3}>3 · strong</option>
                        </select>
                      </div>
                      <div className={base.field} style={{ gridColumn: '1 / -1' }}>
                        <label className={base.label}>Reliability factors</label>
                        <div className={base.checks}>
                          {FACTOR_LABELS.map(([key, label]) => {
                            // A seal is something Janus proved, not something to be ticked, for evidence that arrived as a file.
                            const locked = digitalFromUpload && (key === 'sealed' || key === 'custody')
                            return (
                              <label className={base.check} key={key} title={locked ? 'Set by Janus when it verified the seal; cannot be edited' : undefined}>
                                <input type="checkbox" disabled={locked} checked={item.factors[key]} onChange={(e) => cases.updateEvidence(item.id, { factors: { ...item.factors, [key]: e.target.checked } })} />
                                {label}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                      <div className={base.field} style={{ gridColumn: '1 / -1' }}>
                        <label className={base.label}>Notes</label>
                        <textarea className={base.textarea} style={{ minHeight: 60, userSelect: 'text' }} value={item.notes} onChange={(e) => cases.updateEvidence(item.id, { notes: e.target.value })} />
                      </div>
                    </div>
                    <div className={base.actions}>
                      {confirm === item.id ? (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              cases.removeEvidence(item.id)
                              setConfirm(null)
                              setOpen(null)
                            }}
                          >
                            Remove it (recorded in the case log)
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirm(null)}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" onClick={() => setConfirm(item.id)}>
                          <Trash2 size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                          Remove from case
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function ManualForm({ investigationId, onDone }: { investigationId: string; onDone: () => void }) {
  const cases = useCases()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<EvidenceType>('witness')
  const [source, setSource] = useState('')
  const [notes, setNotes] = useState('')
  const [stance, setStance] = useState<Stance>('neutral')
  const [strength, setStrength] = useState<1 | 2 | 3>(2)
  const [firsthand, setFirsthand] = useState(true)
  const [timestamped, setTimestamped] = useState(false)

  function submit() {
    if (!title.trim()) return
    const item: Evidence = {
      id: newId('e'),
      investigationId,
      agentId: cases.settings.agent,
      title: title.trim(),
      type,
      source: source.trim() || 'unspecified',
      notes,
      stance,
      strength,
      factors: { sealed: false, custody: false, firsthand, timestamped },
      addedAt: new Date().toISOString(),
      origin: 'manual'
    }
    cases.addEvidence([item])
    onDone()
  }

  return (
    <div className={styles.manual}>
      <p className={base.muted}>For an account you were told, an observation, or anything that did not come as a file. Typing something in cannot make it sealed; that has to be proved from a capture.</p>
      <div className={base.field}>
        <label className={base.label}>Title</label>
        <input className={base.input} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className={base.row}>
        <div className={base.field}>
          <label className={base.label}>Type</label>
          <select className={base.select} value={type} onChange={(e) => setType(e.target.value as EvidenceType)}>
            {(Object.keys(EVIDENCE_TYPE_LABELS) as EvidenceType[]).map((t) => (
              <option key={t} value={t}>
                {EVIDENCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className={base.field}>
          <label className={base.label}>Source (person, host, document)</label>
          <input className={base.input} value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>
      <div className={base.row}>
        <div className={base.field}>
          <label className={base.label}>Bears on the hypothesis</label>
          <select className={base.select} value={stance} onChange={(e) => setStance(e.target.value as Stance)}>
            <option value="supports">supports</option>
            <option value="refutes">refutes</option>
            <option value="neutral">neutral</option>
          </select>
        </div>
        <div className={base.field}>
          <label className={base.label}>Strength</label>
          <select className={base.select} value={strength} onChange={(e) => setStrength(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>1 · weak</option>
            <option value={2}>2 · moderate</option>
            <option value={3}>3 · strong</option>
          </select>
        </div>
      </div>
      <div className={base.checks}>
        <label className={base.check}>
          <input type="checkbox" checked={firsthand} onChange={(e) => setFirsthand(e.target.checked)} /> Firsthand
        </label>
        <label className={base.check}>
          <input type="checkbox" checked={timestamped} onChange={(e) => setTimestamped(e.target.checked)} /> Timestamped
        </label>
      </div>
      <div className={base.field}>
        <label className={base.label}>Notes</label>
        <textarea className={base.textarea} style={{ minHeight: 70, userSelect: 'text' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className={base.actions}>
        <Button onClick={submit} disabled={!title.trim()}>
          Add evidence
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
