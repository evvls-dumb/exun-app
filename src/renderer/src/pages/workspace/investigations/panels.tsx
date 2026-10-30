import { useState } from 'react'
import { Check, FileText, Plus, Send, ShieldCheck } from 'lucide-react'
import Button from '@/components/Button'
import Panel from '@/components/Panel'
import {
  ACH_RATING_LABELS,
  analyzeACH,
  assessInvestigation,
  caseTimeline,
  EVIDENCE_TYPE_LABELS,
  strongestLever,
  type AchRating,
  type GradedEvidence,
  type Hypothesis,
  type Verdict
} from '@shared/evidence'
import type { Report } from '@shared/investigation'
import { chainHead, verifyChain, type CaseLogEntry } from '@shared/casechain'
import { newId } from './caseStore'
import styles from './Investigations.module.css'

export const ACH_ORDER: AchRating[] = ['CC', 'C', 'N', 'I', 'II']
const HYP_SHORT: Record<string, string> = { breach: 'Breach', coverup: 'Cover-up', malfunction: 'Malfn.', hoax: 'Hoax' }

export const VERDICT_TEXT: Record<Verdict, string> = {
  supported: 'Hypothesis supported',
  refuted: 'Hypothesis refuted',
  leaning: 'Leaning, not yet conclusive',
  inconclusive: 'Inconclusive'
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function VerdictPanel({
  assessment,
  lever
}: {
  assessment: ReturnType<typeof assessInvestigation>
  lever: ReturnType<typeof strongestLever>
}) {
  const pct = assessment.estimate === null ? null : Math.round(assessment.estimate * 100)
  return (
    <Panel title="Assessment">
      <div className={styles.verdict}>
        <div style={{ minWidth: 0 }}>
          <div className={styles.verdictLabel}>Verdict</div>
          <div className={styles.verdictValue}>{VERDICT_TEXT[assessment.verdict]}</div>
          <div className={styles.meter}>
            <div className={styles.meterFill} style={{ width: `${pct ?? 50}%`, opacity: pct === null ? 0.3 : 1 }} />
          </div>
          <div className={styles.meterScale}>
            <span>refutes</span>
            <span>supports</span>
          </div>
        </div>
        <div>
          <div className={styles.prob}>
            {pct === null ? 'n/a' : pct}
            {pct !== null && <span className={styles.probUnit}>%</span>}
          </div>
          <div className={styles.confNote}>confidence · {assessment.confidenceLabel}</div>
        </div>
      </div>
      {pct === null && (
        <div className={styles.note}>
          No item takes a side yet, so there is nothing to weigh. Open the Evidence tab and mark what each item says about the hypothesis.
        </div>
      )}
      {lever && assessment.verdict !== 'supported' && assessment.verdict !== 'refuted' && (
        <div className={styles.note}>
          <b>Biggest lever:</b> {lever.action}, raises confidence {lever.fromConfidence} → {lever.toConfidence}.
        </div>
      )}
    </Panel>
  )
}

export function DiscrepancyPanel({ items }: { items: ReturnType<typeof assessInvestigation>['discrepancies'] }) {
  return (
    <Panel title="Discrepancies">
      {items.length === 0 ? (
        <div className={styles.clear}>
          <Check size={16} strokeWidth={2} /> Nothing in the evidence contradicts itself.
        </div>
      ) : (
        <div>
          {items.map((d, i) => (
            <div className={styles.disc} key={i}>
              <span className={styles.sevBar} data-sev={d.severity} />
              <div className={styles.discBody}>
                <span className={styles.discTitle}>{d.title}</span>
                <span className={styles.discDetail}>{d.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

export function StepsPanel({ steps, trackedCount = 0, onTrack, onOpenActions }: { steps: string[]; trackedCount?: number; onTrack?: () => number | void; onOpenActions?: () => void }) {
  return (
    <Panel title="Recommended next steps">
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li className={styles.step} key={i}>
            {step}
          </li>
        ))}
      </ol>
      {onTrack && steps.length > 0 && (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => void onTrack()}>
            Track these as actions
          </Button>
          {trackedCount > 0 && onOpenActions && (
            <Button variant="ghost" onClick={onOpenActions}>
              View action list ({trackedCount})
            </Button>
          )}
        </div>
      )}
    </Panel>
  )
}

export function AchPanel({
  ach,
  hypotheses,
  evidence,
  onRate,
  onChange
}: {
  ach: ReturnType<typeof analyzeACH>
  hypotheses: readonly Hypothesis[]
  evidence: GradedEvidence[]
  onRate: (evId: string, hypId: string) => void
  onChange: (next: Hypothesis[]) => void
}) {
  const [editing, setEditing] = useState(false)
  return (
    <Panel title="Competing hypotheses">
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done' : 'Edit hypotheses'}
        </Button>
      </div>
      {editing && (
        <div className={styles.hypEdit}>
          {hypotheses.map((h) => (
            <div className={styles.hypEditRow} key={h.id}>
              <input
                className={styles.input}
                value={h.label}
                onChange={(e) => onChange(hypotheses.map((x) => (x.id === h.id ? { ...x, label: e.target.value } : x)))}
              />
              <Button variant="secondary" onClick={() => onChange(hypotheses.filter((x) => x.id !== h.id))} disabled={hypotheses.length <= 2}>
                Remove
              </Button>
            </div>
          ))}
          <Button variant="secondary" onClick={() => onChange([...hypotheses, { id: newId('h'), label: 'New hypothesis' }])} disabled={hypotheses.length >= 6}>
            <Plus size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Add hypothesis
          </Button>
          <p className={styles.muted}>Rename or add the explanations this case weighs, then rate each against the evidence below.</p>
        </div>
      )}
      <div className={styles.ranked}>
        {ach.hypotheses.map((h) => (
          <div className={styles.rankRow} key={h.id} data-lead={h.rank === 1 || undefined}>
            <span className={styles.rankNo}>{h.rank}</span>
            <div className={styles.rankMain}>
              <div className={styles.rankLabel}>{h.label}</div>
              <div className={styles.likeBar}>
                <div className={styles.likeFill} style={{ width: `${Math.round(h.likelihood * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className={styles.rankPct}>{Math.round(h.likelihood * 100)}%</div>
              <div className={styles.rankSub}>
                incons {h.inconsistency} · {h.inconsistentCount} against
              </div>
            </div>
          </div>
        ))}
      </div>
      {evidence.length > 0 && (
        <div className={styles.matrixWrap}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th>Evidence</th>
                {hypotheses.map((h) => (
                  <th key={h.id}>{HYP_SHORT[h.id] ?? h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.title}
                    <span className={styles.matGrade}>{e.grade}</span>
                  </td>
                  {hypotheses.map((h) => {
                    const r = e.consistency?.[h.id] ?? 'N'
                    return (
                      <td key={h.id}>
                        <button className={styles.mcell} data-r={r} title={ACH_RATING_LABELS[r]} onClick={() => onRate(e.id, h.id)}>
                          {r}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.muted} style={{ marginTop: 8 }}>
            Click a cell to rate how the evidence sits with each hypothesis. The least-contradicted explanation ranks first.
          </p>
        </div>
      )}
    </Panel>
  )
}

export function TimelinePanel({ timeline }: { timeline: ReturnType<typeof caseTimeline> }) {
  return (
    <Panel title="Incident timeline">
      {timeline.entries.length === 0 ? (
        <p className={styles.empty}>No evidence carries an event time yet.</p>
      ) : (
        <div className={styles.timeline}>
          {timeline.entries.map((e) => (
            <div className={styles.tlItem} key={e.id} data-stance={e.stance}>
              <div className={styles.tlTime}>{when(e.when)}</div>
              <div className={styles.tlBody}>
                <span className={styles.tlDot} />
                <div className={styles.tlTitle}>{e.title}</div>
                <div className={styles.tlMeta}>
                  {EVIDENCE_TYPE_LABELS[e.type].toUpperCase()} · {e.grade} · {e.stance.toUpperCase()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {timeline.undated.length > 0 && (
        <div className={styles.tlUndated}>Undated: {timeline.undated.map((u) => `${u.title} (${u.grade})`).join(' · ')}</div>
      )}
    </Panel>
  )
}

export function CaseLogPanel({ log }: { log: CaseLogEntry[] }) {
  const check = verifyChain(log)
  const head = chainHead(log)
  return (
    <Panel title="Case log" icon={<ShieldCheck size={18} strokeWidth={1.75} />}>
      {log.length === 0 ? (
        <p className={styles.empty}>Nothing has been done on this case yet.</p>
      ) : (
        <>
          <div className={styles.logSeal} data-broken={!check.ok || undefined}>
            {check.ok ? (
              <>
                <Check size={14} strokeWidth={2.5} /> Chain intact · {log.length} {log.length === 1 ? 'entry' : 'entries'} · head{' '}
                <span style={{ userSelect: 'text' }}>{head?.slice(0, 16)}…</span>
              </>
            ) : (
              <>Chain broken at entry #{check.at}. The log was altered.</>
            )}
          </div>
          <div className={styles.logList}>
            {[...log].reverse().map((e) => (
              <div className={styles.logRow} key={e.seq}>
                <span className={styles.logTime}>{when(e.time)}</span>
                <span>
                  <span className={styles.logAction}>{e.action}</span> <span className={styles.logDetail}>{e.detail}</span>{' '}
                  <span className={styles.muted}>· {e.actor}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

export function ReportPanel({
  report,
  onChange,
  onDraft,
  onExportPdf
}: {
  report: Report
  onChange: (next: Report) => void
  onDraft?: () => void
  onExportPdf?: () => void
}) {
  const [recipient, setRecipient] = useState('')
  function addRecipient() {
    const value = recipient.trim()
    if (!value || report.recipients.includes(value)) return
    onChange({ ...report, recipients: [...report.recipients, value] })
    setRecipient('')
  }
  return (
    <Panel title="Report" icon={<FileText size={18} strokeWidth={1.75} />}>
      <div className={styles.actions}>
        {onDraft ? (
          <Button variant="secondary" onClick={onDraft}>
            <FileText size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Draft from assessment
          </Button>
        ) : (
          <span className={styles.muted}>Run the analysis to draft a report from it.</span>
        )}
        {onExportPdf && (
          <Button variant="secondary" onClick={onExportPdf}>
            <FileText size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Export PDF
          </Button>
        )}
      </div>
      <textarea
        className={styles.textarea}
        style={{ userSelect: 'text' }}
        placeholder="Write the case report. It stays editable and travels with the investigation."
        value={report.body}
        onChange={(e) => onChange({ ...report, body: e.target.value })}
      />
      <div className={styles.field}>
        <label className={styles.label}>Send to agents (recorded on the report)</label>
        <div className={styles.row}>
          <input
            className={styles.input}
            placeholder="agent or email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRecipient()
            }}
          />
          <Button variant="secondary" onClick={addRecipient} disabled={!recipient.trim()}>
            <Send size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Add recipient
          </Button>
        </div>
      </div>
      {report.recipients.length > 0 && (
        <div className={styles.recipients}>
          {report.recipients.map((r) => (
            <span className={styles.chip} key={r}>
              {r}
            </span>
          ))}
        </div>
      )}
    </Panel>
  )
}
