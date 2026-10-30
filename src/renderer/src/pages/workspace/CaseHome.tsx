import { useCases } from './investigations/caseStore'
import { useCaseAssessment } from './investigations/useAssessment'
import Button from '@/components/Button'
import VaultGate from './investigations/VaultGate'
import { VERDICT_TEXT } from './investigations/panels'
import type { Grade } from '@shared/evidence'
import { actionCounts, sortActions } from '@shared/actions'
import Widget from './Widget'
import styles from './CaseHome.module.css'

const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F']

/** Home for the active investigation. Everything here is read from the case selected in the picker, and the
 *  picker is the same selection the Investigations screen uses, so changing it here changes it there. */
export default function CaseHome({ isRevealed, onNavigate }: { isRevealed: (area: string) => boolean; onNavigate: (v: 'investigations' | 'privacy') => void }) {
  const cases = useCases()
  const v = useCaseAssessment(cases.selectedId)

  if (cases.state === 'locked') return <VaultGate />
  if (cases.state !== 'ready') return <div className={styles.note}>Opening the case vault…</div>

  const list = cases.store.investigations
  if (list.length === 0 || !v.inv) {
    return (
      <Widget area="case" title="No active case" revealed={isRevealed('case')}>
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{list.length === 0 ? 'Nothing is open. Start an investigation.' : 'Pick a case to work on.'}</h2>
          <p className={styles.gateText}>Home shows the state of the investigation you are working on: what the evidence is worth, what does not add up, and what to do next.</p>
          <div className={styles.actions}>
            <Button onClick={() => onNavigate('investigations')}>{list.length === 0 ? 'Start an investigation' : 'Open investigations'}</Button>
          </div>
        </div>
      </Widget>
    )
  }

  const { inv, evidence, assessment, analysed, stale, counts } = v
  const pct = assessment.estimate === null ? null : Math.round(assessment.estimate * 100)
  const gradeCount = Object.fromEntries(GRADES.map((g) => [g, assessment.graded.filter((e) => e.grade === g).length]))
  const max = Math.max(1, ...Object.values(gradeCount))
  const w = inv.incident
  const tracked = cases.actionsOf(inv.id)
  const counts2 = actionCounts(tracked, new Date().toISOString().slice(0, 10))
  const open = (tab: string) => {
    cases.openCase(inv.id, tab)
    onNavigate('investigations')
  }

  return (
    <>
      <Widget
        area="case"
        title="Active case"
        revealed={isRevealed('case')}
        meta={
          list.length > 1 ? (
            <select className={styles.pick} value={inv.id} onChange={(e) => cases.select(e.target.value)} aria-label="Active investigation" style={{ background: 'var(--color-frame)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
              {list.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title.slice(0, 48)}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        <h2 className={styles.caseTitle}>{inv.title}</h2>
        {inv.hypothesis && <p className={styles.hyp}>{inv.hypothesis}</p>}
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span className={styles.factK}>Evidence</span>
            <span className={styles.factV}>{evidence.length}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factK}>Seals verified</span>
            <span className={styles.factV} data-tone={counts.broken ? 'bad' : counts.verified ? 'good' : undefined}>
              {counts.verified}
            </span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factK}>Incident window</span>
            <span className={styles.factV} data-tone={w ? undefined : 'warn'}>
              {w ? (w.from.slice(0, 10) === w.to.slice(0, 10) ? w.from.slice(0, 10) : `${w.from.slice(5, 10)} → ${w.to.slice(5, 10)}`) : 'not set'}
            </span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factK}>Last analysis</span>
            <span className={styles.factV} data-tone={!analysed ? 'warn' : stale ? 'warn' : 'good'}>
              {!analysed ? 'never' : stale ? 'stale' : 'current'}
            </span>
          </div>
        </div>
      </Widget>

      <Widget area="verdict" title="Verdict" revealed={isRevealed('verdict')} accent>
        <div className={styles.verdict}>
          {!analysed ? (
            <>
              <div className={styles.verdictName}>Not analysed</div>
              <p className={styles.gateText}>
                {evidence.length === 0 ? 'No evidence is on file yet.' : `${evidence.length} item${evidence.length === 1 ? '' : 's'} on file. Nothing is weighed until you run the analysis.`}
              </p>
              <div className={styles.actions}>
                {evidence.length === 0 ? <Button onClick={() => open('intake')}>Add evidence</Button> : <Button onClick={() => cases.runAnalysis(inv.id)}>Run analysis</Button>}
              </div>
            </>
          ) : (
            <>
              <div className={styles.verdictName}>{VERDICT_TEXT[assessment.verdict]}</div>
              <div className={styles.big}>
                {pct === null ? 'n/a' : pct}
                {pct !== null && <span className={styles.bigUnit}>%</span>}
              </div>
              <div className={styles.sub}>confidence · {assessment.confidenceLabel}</div>
              {stale && <div className={`${styles.sub} ${styles.stale}`}>The case has changed since this was run.</div>}
              <div className={styles.actions}>
                {stale && <Button onClick={() => cases.runAnalysis(inv.id)}>Run again</Button>}
                <Button variant="secondary" onClick={() => open('analysis')}>
                  Open analysis
                </Button>
              </div>
            </>
          )}
        </div>
      </Widget>

      <Widget area="evidence" title="Evidence quality" revealed={isRevealed('evidence')} meta={`${evidence.length} items`}>
        {evidence.length === 0 ? (
          <p className={styles.gateText}>Grades appear here once evidence is filed.</p>
        ) : (
          <>
            <div className={styles.bars}>
              {GRADES.map((g) => (
                <div className={styles.barRow} key={g}>
                  <span>{g}</span>
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} data-g={g} style={{ width: `${(gradeCount[g] / max) * 100}%` }} />
                  </div>
                  <span>{gradeCount[g]}</span>
                </div>
              ))}
            </div>
            <div className={styles.seals}>
              <span className={styles.chip} data-tone={counts.verified ? 'good' : undefined}>
                {counts.verified} verified
              </span>
              {counts.claims > 0 && (
                <span className={styles.chip} data-tone="warn">
                  {counts.claims} claim{counts.claims === 1 ? '' : 's'}
                </span>
              )}
              {counts.broken > 0 && (
                <span className={styles.chip} data-tone="bad">
                  {counts.broken} broken
                </span>
              )}
            </div>
          </>
        )}
      </Widget>

      <Widget area="issues" title="What does not add up" revealed={isRevealed('issues')} meta={analysed ? `${assessment.discrepancies.length}` : undefined}>
        {!analysed ? (
          <p className={styles.gateText}>Discrepancies are found when the analysis runs.</p>
        ) : assessment.discrepancies.length === 0 ? (
          <p className={styles.gateText}>Nothing in the evidence contradicts itself.</p>
        ) : (
          <ul className={styles.list}>
            {assessment.discrepancies.slice(0, 5).map((d, i) => (
              <li className={styles.item} key={i}>
                <span className={styles.sev} data-sev={d.severity} />
                <div>
                  <b>{d.title}</b>
                  <span>{d.detail.length > 150 ? `${d.detail.slice(0, 150)}…` : d.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Widget>

      <Widget area="steps" title="Do next" revealed={isRevealed('steps')} meta={tracked.length ? `${counts2.open + counts2.doing} open${counts2.overdue ? ` · ${counts2.overdue} overdue` : ''}` : undefined}>
        {!analysed && tracked.length === 0 ? (
          <p className={styles.gateText}>Recommended steps appear after the analysis.</p>
        ) : (
          <>
            <ul className={styles.list}>
              {tracked.length > 0
                ? sortActions(tracked)
                    .filter((a) => a.status !== 'done')
                    .slice(0, 2)
                    .map((a) => (
                      <li className={styles.item} key={a.id}>
                        <input type="checkbox" aria-label={`Mark done: ${a.text.slice(0, 60)}`} onChange={() => cases.setActionStatus(inv.id, a.id, 'done')} />
                        <span style={{ color: 'var(--color-text)' }}>
                          {a.text.length > 150 ? `${a.text.slice(0, 150)}…` : a.text}
                          {(a.owner || a.due) && <span style={{ color: 'var(--color-text-muted)' }}> · {[a.owner, a.due && `due ${a.due}`].filter(Boolean).join(' · ')}</span>}
                        </span>
                      </li>
                    ))
                : assessment.nextSteps.slice(0, 2).map((s, i) => (
                    <li className={styles.item} key={i}>
                      <span className={styles.stepN}>{i + 1}</span>
                      <span style={{ color: 'var(--color-text)' }}>{s.length > 170 ? `${s.slice(0, 170)}…` : s}</span>
                    </li>
                  ))}
              {tracked.length > 0 && counts2.open + counts2.doing === 0 && <li className={styles.item}><span className={styles.gateText}>Everything on the action list is done.</span></li>}
            </ul>
            <div className={styles.actions}>
              {tracked.length === 0 ? (
                <Button variant="secondary" onClick={() => cases.trackSteps(inv.id, assessment.nextSteps)}>
                  Track these steps
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => open('actions')}>
                  Open action list
                </Button>
              )}
            </div>
          </>
        )}
      </Widget>
    </>
  )
}
