import { useState } from 'react'
import Button from '@/components/Button'
import { useCases } from './caseStore'
import base from './Investigations.module.css'
import styles from './Platform.module.css'

const TAGS = ['Arcade escape', 'Power anomaly', 'Other']

export default function NewInvestigation({ onDone, onCancel }: { onDone: (id: string) => void; onCancel?: () => void }) {
  const cases = useCases()
  const [title, setTitle] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [tag, setTag] = useState(TAGS[0])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const bad = !!from && !!to && to < from
  const ok = title.trim().length > 0 && !bad

  function create() {
    if (!ok) return
    const incident = from ? { from, to: to || from } : undefined
    onDone(cases.createInvestigation({ title, hypothesis, tag, incident }))
  }

  return (
    <form
      className={styles.newForm}
      onSubmit={(e) => {
        e.preventDefault()
        create()
      }}
    >
      <div className={base.field}>
        <label className={base.label}>Title</label>
        <input className={base.input} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wenoti Arcade, “The Reckoning V”" />
      </div>
      <div className={base.field}>
        <label className={base.label}>What are you testing?</label>
        <textarea
          className={base.textarea}
          style={{ minHeight: 76, fontFamily: 'var(--font-sans)', userSelect: 'text' }}
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          placeholder="One sentence a piece of evidence can support or refute."
        />
      </div>
      <div className={base.row}>
        <div className={base.field}>
          <label className={base.label}>Kind of incident</label>
          <select className={base.select} value={tag} onChange={(e) => setTag(e.target.value)}>
            {TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className={base.field}>
          <label className={base.label}>Incident from</label>
          <input className={base.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={base.field}>
          <label className={base.label}>Incident to</label>
          <input className={base.input} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <p className={base.muted}>
        The incident window is what Janus checks every record against: whether a log even covers the time in question, and whether what it shows during that time supports or undermines the hypothesis. You can set it later.
      </p>
      {bad && <div className={styles.error}>The window ends before it starts.</div>}
      <div className={base.actions}>
        <Button type="submit" disabled={!ok}>
          Open investigation
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
