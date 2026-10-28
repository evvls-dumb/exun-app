import { GAME_SOURCE, SOURCE_ANALYSIS } from '@shared/gameSource'
import type { ClassInfo, UseKind } from '@shared/source'
import CodeLine from '@/components/CodeLine'
import { formatShortDate } from '@/lib/format'
import SourceCode from './SourceCode'
import SourceSummary from './SourceSummary'
import Widget from './Widget'
import lists from './MachineLists.module.css'
import styles from './SourceView.module.css'

const USE_LABELS: Record<UseKind, string> = {
  type: 'Type',
  member: 'Call',
  object: 'Object'
}

function memberKind(member: string, owner: ClassInfo): string {
  if (!member.includes('(')) return 'Field'
  return member.startsWith(`${owner.name}(`) ? 'Constructor' : 'Method'
}

export default function SourceView() {
  const analysis = SOURCE_ANALYSIS
  const types = new Set(analysis.original.classes.map((item) => item.name))
  const removed = analysis.removedClasses

  return (
    <main className={styles.grid}>
      <SourceCode area="code" file={GAME_SOURCE.file} analysis={analysis} />

      <Widget
        area="summary"
        title="Source summary"
        meta={`Recovered ${formatShortDate(GAME_SOURCE.recoveredOn)}`}
        revealed
        accent
      >
        <SourceSummary analysis={analysis} recoveredOn={GAME_SOURCE.recoveredOn} />
      </Widget>

      <Widget
        area="uses"
        title="Still depends on it"
        meta={<span className={styles.warn}>{analysis.dangling.length} lines</span>}
        revealed
      >
        <ul className={lists.list}>
          {analysis.dangling.map((use, index) => (
            <li
              key={use.line}
              className={`${lists.row} ${lists.compact}`}
              style={{ animationDelay: `${index * 30}ms` }}
              title={`Line ${use.line} of the recovered file`}
            >
              <span className={styles.line}>{use.line}</span>
              <div className={`${lists.text} ${styles.snippet}`}>
                <CodeLine text={use.text} types={types} />
              </div>
              <span className={styles.kind} data-kind={use.kind}>
                {USE_LABELS[use.kind]}
              </span>
            </li>
          ))}
        </ul>
      </Widget>

      <Widget
        area="members"
        title="What was removed"
        meta={removed.map((item) => item.name).join(', ') || 'Nothing'}
        revealed
      >
        <ul className={lists.list}>
          {removed.flatMap((owner) =>
            owner.members.map((member, index) => (
              <li
                key={`${owner.name}-${member}`}
                className={`${lists.row} ${lists.compact}`}
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <div className={`${lists.text} ${styles.snippet}`}>
                  <CodeLine text={member} types={types} />
                </div>
                <span className={styles.kind}>{memberKind(member, owner)}</span>
              </li>
            ))
          )}
        </ul>
      </Widget>
    </main>
  )
}
