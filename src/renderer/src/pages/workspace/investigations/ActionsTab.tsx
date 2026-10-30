import { useState } from 'react'
import { ListPlus, Plus, Trash2 } from 'lucide-react'
import Button from '@/components/Button'
import Panel from '@/components/Panel'
import { actionCounts, isOverdue, sortActions, validDate } from '@shared/actions'
import type { ActionItem } from '@shared/investigation'
import { useCases } from './caseStore'
import base from './Investigations.module.css'
import styles from './Platform.module.css'

const STATUS: { id: ActionItem['status']; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' }
]

const today = () => new Date().toISOString().slice(0, 10)

/** The work that follows from the analysis: recommended steps turned into things someone owns and dates. */
export default function ActionsTab({ investigationId, steps, analysed }: { investigationId: string; steps: readonly string[]; analysed: boolean }) {
  const cases = useCases()
  const items = sortActions(cases.actionsOf(investigationId))
  const counts = actionCounts(items, today())
  const [text, setText] = useState('')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const tracked = new Set(items.map((a) => a.text.toLowerCase().replace(/\s+/g, ' ').trim()))
  const untracked = steps.filter((s) => !tracked.has(s.toLowerCase().replace(/\s+/g, ' ').trim()))

  return (
    <div className={styles.stack}>
      <Panel title={`Actions (${counts.open + counts.doing} open${counts.overdue ? `, ${counts.overdue} overdue` : ''})`} icon={<ListPlus size={18} strokeWidth={1.75} />}>
        {analysed && untracked.length > 0 && (
          <div className={styles.nextBar}>
            <span className={base.muted}>
              {untracked.length} recommended step{untracked.length === 1 ? ' is' : 's are'} not on the list.
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                const n = cases.trackSteps(investigationId, steps)
                setNote(`${n} step${n === 1 ? '' : 's'} added.`)
              }}
            >
              Track recommended steps
            </Button>
          </div>
        )}
        {!analysed && items.length === 0 && <p className={base.muted}>Run the analysis and Janus will suggest steps you can track here. You can also add your own below.</p>}
        {note && <div className={base.note}>{note}</div>}

        {items.length === 0 ? (
          <p className={base.empty}>Nothing is being tracked yet.</p>
        ) : (
          <ul className={styles.actionList}>
            {items.map((a) => (
              <li key={a.id} className={styles.actionRow} data-status={a.status} data-overdue={isOverdue(a, today()) || undefined}>
                <select className={base.select} aria-label={`Status of: ${a.text.slice(0, 40)}`} value={a.status} onChange={(e) => cases.setActionStatus(investigationId, a.id, e.target.value as ActionItem['status'])}>
                  {STATUS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <div className={styles.actionText}>
                  <span>{a.text}</span>
                  <span className={base.muted}>
                    {a.source === 'recommended' ? 'Recommended' : 'Added by hand'}
                    {a.owner ? ` · ${a.owner}` : ''}
                    {a.due ? ` · due ${a.due}${isOverdue(a, today()) ? ' (overdue)' : ''}` : ''}
                    {a.doneAt ? ` · done ${a.doneAt.slice(0, 10)}` : ''}
                  </span>
                </div>
                <input
                  className={base.input}
                  type="date"
                  aria-label="Due date"
                  value={a.due ?? ''}
                  onChange={(e) => cases.updateAction(investigationId, a.id, { due: validDate(e.target.value) ? e.target.value : undefined })}
                />
                <Button variant="ghost" aria-label="Remove this action" onClick={() => cases.removeAction(investigationId, a.id)}>
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Add an action">
        <form
          className={base.row}
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            cases.addAction(investigationId, text, owner, due)
            setText('')
            setOwner('')
            setDue('')
            setNote(null)
          }}
        >
          <input className={base.input} style={{ flex: '3 1 260px' }} placeholder="What needs to happen" aria-label="Action" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <input className={base.input} placeholder="Owner" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={40} />
          <input className={base.input} type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button type="submit" disabled={!text.trim()}>
            <Plus size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Add
          </Button>
        </form>
      </Panel>
    </div>
  )
}
