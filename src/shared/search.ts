// Search across everything in the vault: cases, evidence, findings, notes, reports, tracked actions and the
// case log. Runs locally on the decrypted store held in memory; nothing is indexed to disk.
import type { InvestigationStore } from './investigation'

export type HitKind = 'case' | 'evidence' | 'finding' | 'report' | 'action' | 'log'

export interface Hit {
  kind: HitKind
  investigationId: string
  /** The evidence or action id, when the hit is one. */
  ref?: string
  title: string
  snippet: string
  score: number
  /** The tab in the case view that shows it. */
  tab: 'overview' | 'evidence' | 'analysis' | 'report' | 'custody' | 'actions'
}

const WEIGHT: Record<HitKind, number> = { case: 6, evidence: 5, finding: 4, action: 3, report: 3, log: 1 }
export const MIN_QUERY = 2

function around(text: string, at: number, len: number): string {
  const from = Math.max(0, at - 40)
  const piece = text.slice(from, at + len + 80).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${piece}${at + len + 80 < text.length ? '…' : ''}`
}

/** All terms must appear (in any order). A hit's score favours the kind of thing it is and a match in its title. */
export function searchStore(store: InvestigationStore, query: string, limit = 40): Hit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.join('').length < MIN_QUERY) return []
  const hits: Hit[] = []

  const test = (fields: string[], titleField: string): { snippet: string; inTitle: boolean } | null => {
    const hay = fields.join('\n')
    const low = hay.toLowerCase()
    if (!terms.every((t) => low.includes(t))) return null
    const first = low.indexOf(terms[0])
    return { snippet: around(hay, first, terms[0].length), inTitle: terms.every((t) => titleField.toLowerCase().includes(t)) }
  }
  const push = (h: Omit<Hit, 'score'>, m: { inTitle: boolean }) => hits.push({ ...h, score: WEIGHT[h.kind] + (m.inTitle ? 4 : 0) })

  for (const inv of store.investigations) {
    const m = test([inv.title, inv.hypothesis, inv.tag ?? '', ...(inv.agents ?? [])], inv.title)
    if (m) push({ kind: 'case', investigationId: inv.id, title: inv.title, snippet: m.snippet, tab: 'overview' }, m)

    const report = store.reports[inv.id]
    if (report) {
      const r = test([report.body], '')
      if (r) push({ kind: 'report', investigationId: inv.id, title: `Report · ${inv.title}`, snippet: r.snippet, tab: 'report' }, r)
    }
    for (const a of store.actions[inv.id] ?? []) {
      const r = test([a.text, a.owner ?? ''], a.text)
      if (r) push({ kind: 'action', investigationId: inv.id, ref: a.id, title: a.text.slice(0, 80), snippet: `${a.status}${a.owner ? ` · ${a.owner}` : ''}${a.due ? ` · due ${a.due}` : ''}`, tab: 'actions' }, r)
    }
    for (const e of store.logs[inv.id] ?? []) {
      const r = test([e.action, e.detail, e.actor], '')
      if (r) push({ kind: 'log', investigationId: inv.id, title: `${e.action} · ${inv.title}`, snippet: r.snippet, tab: 'custody' }, r)
    }
  }

  for (const e of store.evidence) {
    const inv = store.investigations.find((i) => i.id === e.investigationId)
    if (!inv) continue
    const m = test([e.title, e.source, e.notes, e.fileName ?? '', e.agentId, e.fileSha256 ?? '', e.chainHead ?? '', ...(e.facts?.identifiers ?? [])], e.title)
    if (m) push({ kind: 'evidence', investigationId: inv.id, ref: e.id, title: e.title, snippet: m.snippet, tab: 'evidence' }, m)
    for (const f of e.findings ?? []) {
      const r = test([f.title, f.detail], f.title)
      if (r) push({ kind: 'finding', investigationId: inv.id, ref: e.id, title: f.title, snippet: `${e.title}: ${r.snippet}`, tab: 'analysis' }, r)
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
