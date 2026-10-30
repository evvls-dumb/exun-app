// Narrowing and ordering the evidence list. Pure, so what the screen shows can be checked.
import type { EvidenceType, Grade, GradedEvidence, Stance } from './evidence'

export interface EvidenceFilter {
  text: string
  type: EvidenceType | 'all'
  stance: Stance | 'all'
  /** Show only this grade or worse/better. 'all' shows everything. */
  grade: Grade | 'all'
  seal: 'all' | 'verified' | 'claim' | 'broken' | 'none'
  agent: string | 'all'
}

export const NO_FILTER: EvidenceFilter = { text: '', type: 'all', stance: 'all', grade: 'all', seal: 'all', agent: 'all' }
export type EvidenceSort = 'added' | 'grade' | 'time' | 'title'

export const isFiltered = (f: EvidenceFilter): boolean => JSON.stringify(f) !== JSON.stringify(NO_FILTER)

export function sealOf(e: GradedEvidence): EvidenceFilter['seal'] {
  const s = e.verification?.state
  return s === 'verified' ? 'verified' : s === 'failed' ? 'broken' : s === 'unchecked' ? 'claim' : 'none'
}

export function filterEvidence(items: readonly GradedEvidence[], f: EvidenceFilter): GradedEvidence[] {
  const q = f.text.trim().toLowerCase()
  return items.filter((e) => {
    if (f.type !== 'all' && e.type !== f.type) return false
    if (f.stance !== 'all' && e.stance !== f.stance) return false
    if (f.grade !== 'all' && e.grade !== f.grade) return false
    if (f.seal !== 'all' && sealOf(e) !== f.seal) return false
    if (f.agent !== 'all' && e.agentId !== f.agent) return false
    if (q && ![e.title, e.source, e.notes, e.fileName ?? '', e.agentId].some((t) => t.toLowerCase().includes(q))) return false
    return true
  })
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function sortEvidence(items: readonly GradedEvidence[], by: EvidenceSort): GradedEvidence[] {
  const out = [...items]
  switch (by) {
    case 'grade':
      return out.sort((a, b) => b.score - a.score || cmpStr(a.title, b.title))
    case 'time':
      // Items with no known time go last: an unknown time is not treated as the earliest or the latest.
      return out.sort((a, b) => (a.occurredAt && b.occurredAt ? cmpStr(a.occurredAt, b.occurredAt) : a.occurredAt ? -1 : b.occurredAt ? 1 : 0))
    case 'title':
      return out.sort((a, b) => cmpStr(a.title.toLowerCase(), b.title.toLowerCase()))
    default:
      return out.sort((a, b) => cmpStr(b.addedAt, a.addedAt))
  }
}
