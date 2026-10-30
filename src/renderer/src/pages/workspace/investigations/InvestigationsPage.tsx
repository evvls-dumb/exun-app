import { useEffect, useState } from 'react'
import { FolderSearch, Plus, Trash2, TriangleAlert } from 'lucide-react'
import Button from '@/components/Button'
import Panel from '@/components/Panel'
import type { JanusApi } from '@shared/api'
import { buildCaseReport } from '@shared/evidence'
import { chainHead } from '@shared/casechain'
import { buildCaseReportHtml } from '@shared/casereport'
import { CaseStoreProvider, useCases } from './caseStore'
import { useCaseAssessment } from './useAssessment'
import ActionsTab from './ActionsTab'
import CustodyTab from './CustodyTab'
import EvidenceTab from './EvidenceTab'
import Intake from './Intake'
import NewInvestigation from './NewInvestigation'
import { ACH_ORDER, AchPanel, DiscrepancyPanel, ReportPanel, StepsPanel, TimelinePanel, VerdictPanel } from './panels'
import VaultGate from './VaultGate'
import base from './Investigations.module.css'
import styles from './Platform.module.css'

type Tab = 'intake' | 'evidence' | 'analysis' | 'actions' | 'report' | 'custody'

export { CaseStoreProvider }

export default function InvestigationsPage() {
  const cases = useCases()
  const [creating, setCreating] = useState(false)

  if (cases.state === 'loading') return <div className={styles.center}>Opening the case vault…</div>
  if (cases.state === 'locked') return <VaultGate />
  if (cases.state === 'error') return <div className={styles.center}><div className={styles.error}>The case vault could not be read: {cases.error}</div></div>

  const list = cases.store.investigations
  const selected = list.find((i) => i.id === cases.selectedId) ?? null
  const showForm = creating || list.length === 0

  return (
    <div className={base.page}>
      <div className={base.list}>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} strokeWidth={2} style={{ marginRight: 8, verticalAlign: '-3px' }} />
          New investigation
        </Button>
        <div className={base.listScroll}>
          {list.map((item) => {
            const count = cases.store.evidence.filter((e) => e.investigationId === item.id).length
            return (
              <button
                key={item.id}
                type="button"
                className={base.invCard}
                data-active={(item.id === cases.selectedId && !showForm) || undefined}
                onClick={() => {
                  cases.select(item.id)
                  setCreating(false)
                }}
              >
                <div className={base.invCardTop}>
                  <span className={base.invTitle}>{item.title}</span>
                </div>
                <span className={base.invMeta}>
                  {count} EVIDENCE{item.tag && item.tag !== 'Unexplained behaviour' ? ` · ${item.tag.toUpperCase()}` : ''}
                </span>
              </button>
            )
          })}
        </div>
        {!cases.persistent && <div className={base.note}>Preview mode: nothing here is saved.</div>}
        {cases.saveError && <div className={styles.error}>Could not save: {cases.saveError}</div>}
      </div>

      {showForm ? (
        <div className={base.main}>
          {list.length === 0 && (
            <div className={styles.hero}>
              <div className={base.eyebrow}>
                No cases open
              </div>
              <h1 className={styles.heroTitle}>Start an investigation, then give Janus everything you have.</h1>
              <p className={styles.heroText}>
                Nothing is pre-loaded. Open a case, drop in the field-unit captures, logs, ledgers, diffs and statements, and Janus will verify what it can prove, flag what it cannot, and only then weigh it. Your cases stay on this computer
                {cases.vault.mode === 'sealed' ? ', sealed under your passphrase.' : '. Turn on the sealed vault under Privacy to encrypt them.'}
              </p>
            </div>
          )}
          <Panel title="New investigation" icon={<FolderSearch size={18} strokeWidth={1.75} />}>
            <NewInvestigation onDone={() => setCreating(false)} onCancel={list.length > 0 ? () => setCreating(false) : undefined} />
          </Panel>
        </div>
      ) : selected ? (
        <CaseView key={selected.id} investigationId={selected.id} />
      ) : (
        <div className={base.main}>
          <p className={base.empty}>Select an investigation.</p>
        </div>
      )}
    </div>
  )
}

function CaseView({ investigationId }: { investigationId: string }) {
  const cases = useCases()
  const janus = (globalThis as unknown as { janus?: JanusApi }).janus
  const view = useCaseAssessment(investigationId)
  const inv = view.inv!
  const evidence = view.evidence
  const [tab, setTab] = useState<Tab>(() => {
    const want = cases.pendingTab as Tab | null
    if (want && ['intake', 'evidence', 'analysis', 'actions', 'report', 'custody'].includes(want)) return want
    return evidence.length === 0 ? 'intake' : inv.analysis ? 'analysis' : 'evidence'
  })
  const [editingWindow, setEditingWindow] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
  }, [tab])

  useEffect(() => {
    if (cases.pendingTab) cases.openCase(investigationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { assessment, lever, hypotheses, ach, timeline, stale, counts } = view
  const verified = counts.verified
  const unverified = counts.claims + counts.broken
  const failed = counts.broken
  const report = cases.store.reports[investigationId] ?? { body: '', recipients: [] }


  function rate(evId: string, hypId: string) {
    const e = evidence.find((x) => x.id === evId)
    if (!e) return
    const current = e.consistency?.[hypId] ?? 'N'
    const next = ACH_ORDER[(ACH_ORDER.indexOf(current) + 1) % ACH_ORDER.length]
    cases.updateEvidence(evId, { consistency: { ...(e.consistency ?? {}), [hypId]: next } })
  }

  const openActions = cases.actionsOf(investigationId).filter((a) => a.status !== 'done').length
  const tabs: [Tab, string][] = [
    ['intake', 'Intake'],
    ['evidence', `Evidence (${evidence.length})`],
    ['analysis', 'Analysis'],
    ['actions', openActions ? `Actions (${openActions})` : 'Actions'],
    ['report', 'Report'],
    ['custody', 'Custody & sharing']
  ]

  return (
    <div className={base.main}>
      <div className={base.caseHead}>
        <div className={base.eyebrow}>
          {inv.tag && inv.tag !== 'Unexplained behaviour' && <span>{inv.tag}</span>}
          <span>lead {inv.lead}</span>
        </div>
        <h1 className={base.caseTitle}>{inv.title}</h1>
        {inv.hypothesis && <p className={base.hypothesis}>{inv.hypothesis}</p>}
        <WindowLine investigationId={investigationId} editing={editingWindow} setEditing={setEditingWindow} />
      </div>

      <div className={styles.tabs} role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={styles.tab} data-active={tab === id || undefined} onClick={() => setTab(id)}>
            {label}
            {id === 'analysis' && stale && <i className={styles.dot} title="Evidence has changed since the last analysis" />}
          </button>
        ))}
      </div>

      {tab === 'intake' && <Intake investigation={inv} existing={evidence} onCommitted={() => setTab('evidence')} />}

      {tab === 'evidence' && (
        <>
          <EvidenceTab investigationId={investigationId} graded={assessment.graded} />
          {evidence.length > 0 && (
            <div className={styles.nextBar}>
              <span className={base.muted}>Check what each item says about the hypothesis, then run the analysis.</span>
              <Button onClick={() => setTab('analysis')}>Go to analysis</Button>
            </div>
          )}
        </>
      )}

      {tab === 'analysis' &&
        (!inv.analysis ? (
          <Panel title="Analysis">
            <div className={styles.gateAnalysis}>
              <div className={styles.bigNum}>{evidence.length}</div>
              <div>
                <div className={styles.gateHead}>{evidence.length === 0 ? 'No evidence to analyse yet' : 'Not analysed yet'}</div>
                <p className={base.muted}>
                  {evidence.length === 0
                    ? 'Add what you have on the Intake tab first.'
                    : `${evidence.length} item${evidence.length === 1 ? '' : 's'} on file · ${verified} with a seal Janus verified${unverified ? ` · ${unverified} unverified or broken` : ''}. Running the analysis grades each item, checks them against one another and against the incident window, weighs the competing explanations, and records that it was run in the case log.`}
                </p>
                {failed > 0 && (
                  <div className={styles.error}>
                    <TriangleAlert size={14} style={{ verticalAlign: '-2px' }} /> {failed} capture{failed === 1 ? '' : 's'} failed seal verification. The analysis will treat {failed === 1 ? 'it' : 'them'} as unsealed.
                  </div>
                )}
                <div className={base.actions}>
                  <Button onClick={() => cases.runAnalysis(investigationId)} disabled={evidence.length === 0}>
                    Run analysis
                  </Button>
                </div>
              </div>
            </div>
          </Panel>
        ) : (
          <>
            {stale && (
              <div className={styles.stale}>
                The evidence or incident window has changed since the analysis was run on {new Date(inv.analysis.at).toLocaleString()}. What is shown reflects the case as it is now.
                <Button variant="secondary" onClick={() => cases.runAnalysis(investigationId)}>
                  Run again
                </Button>
              </div>
            )}
            {!stale && <div className={base.muted}>Analysis run {new Date(inv.analysis.at).toLocaleString()} by {inv.analysis.by} · digest {inv.analysis.digest.slice(0, 12)}…</div>}
            <VerdictPanel assessment={assessment} lever={lever} />
            <div className={base.cols}>
              <DiscrepancyPanel items={assessment.discrepancies} />
              <StepsPanel
                steps={assessment.nextSteps}
                trackedCount={cases.actionsOf(investigationId).length}
                onTrack={() => cases.trackSteps(investigationId, assessment.nextSteps)}
                onOpenActions={() => setTab('actions')}
              />
            </div>
            <AchPanel ach={ach} hypotheses={hypotheses} evidence={assessment.graded} onRate={rate} onChange={(next) => cases.updateInvestigation(investigationId, { hypotheses: next })} />
            <TimelinePanel timeline={timeline} />
          </>
        ))}

      {tab === 'actions' && <ActionsTab investigationId={investigationId} steps={assessment.nextSteps} analysed={!!inv.analysis} />}

      {tab === 'report' && (
        <ReportPanel
          report={report}
          onChange={(next) => cases.setReport(investigationId, next)}
          onDraft={
            inv.analysis
              ? () =>
                  cases.setReport(investigationId, {
                    ...report,
                    body: buildCaseReport({ title: inv.title, hypothesis: inv.hypothesis, incident: inv.incident ?? null }, assessment)
                  })
              : undefined
          }
          onExportPdf={
            janus?.investigations
              ? async () => {
                  const html = buildCaseReportHtml({
                    investigation: { title: inv.title, hypothesis: inv.hypothesis, lead: inv.lead },
                    assessment,
                    ach,
                    reportBody: report.body,
                    chainHead: chainHead(cases.store.logs[investigationId] ?? [])
                  })
                  const saved = await janus.investigations.exportPdf(inv.title, html).catch(() => null)
                  if (saved) cases.logAction(investigationId, 'report:pdf', 'Exported report as PDF')
                }
              : undefined
          }
        />
      )}

      {tab === 'custody' && (
        <>
          <CustodyTab investigationId={investigationId} />
          <Panel title="Remove this investigation">
            <p className={base.muted}>Deletes the case, its evidence, report and log from this computer. Files you dropped in are never touched. This cannot be undone.</p>
            <div className={base.actions}>
              {confirmDelete ? (
                <>
                  <Button variant="secondary" onClick={() => cases.deleteInvestigation(investigationId)}>
                    Delete “{inv.title.slice(0, 40)}” permanently
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                  Delete investigation…
                </Button>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}

function WindowLine({ investigationId, editing, setEditing }: { investigationId: string; editing: boolean; setEditing: (v: boolean) => void }) {
  const cases = useCases()
  const inv = cases.store.investigations.find((i) => i.id === investigationId)!
  const [from, setFrom] = useState(inv.incident?.from.slice(0, 10) ?? '')
  const [to, setTo] = useState(inv.incident?.to.slice(0, 10) ?? '')
  const w = inv.incident
  const bad = !!from && !!to && to < from

  function save() {
    if (bad) return
    cases.updateInvestigation(investigationId, { incident: from ? { from, to: to || from } : undefined })
    cases.logAction(investigationId, 'incident:window', from ? `${from} → ${to || from}` : 'cleared')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={styles.windowEdit}>
        <input className={base.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Incident from" />
        <span className={base.muted}>to</span>
        <input className={base.input} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Incident to" />
        <Button variant="secondary" onClick={save} disabled={bad}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    )
  }
  return (
    <div className={styles.windowLine}>
      <span className={styles.windowKey}>INCIDENT WINDOW</span>
      {w ? (
        <span>{w.from.slice(0, 10) === w.to.slice(0, 10) ? w.from.slice(0, 10) : `${w.from.slice(0, 10)} → ${w.to.slice(0, 10)}`}</span>
      ) : (
        <span className={base.muted}>not set, so records can’t be checked against the incident</span>
      )}
      <button type="button" className={styles.linkBtn} onClick={() => setEditing(true)}>
        {w ? 'change' : 'set'}
      </button>
    </div>
  )
}
