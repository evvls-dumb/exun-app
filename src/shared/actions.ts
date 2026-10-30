// Trackable work. The analysis recommends next steps; this turns a recommendation into something an agent
// owns, dates and ticks off, without losing which ones came from the analysis and which were written by hand.
import type { ActionItem } from './investigation'

const key = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()

export const STATUS_ORDER: Record<ActionItem['status'], number> = { doing: 0, open: 1, done: 2 }

/** Add recommended steps that are not already tracked. A step already on the list, in any state, is not
 *  added again, so re-running the analysis does not re-open work that was finished. */
export function adoptSteps(existing: readonly ActionItem[], steps: readonly string[], makeId: () => string, now: string): { items: ActionItem[]; added: number } {
  const seen = new Set(existing.map((a) => key(a.text)))
  const fresh: ActionItem[] = []
  for (const text of steps) {
    const k = key(text)
    if (!k || seen.has(k)) continue
    seen.add(k)
    fresh.push({ id: makeId(), text: text.trim(), status: 'open', source: 'recommended', createdAt: now })
  }
  return { items: [...existing, ...fresh], added: fresh.length }
}

export function manualAction(text: string, id: string, now: string, owner?: string, due?: string): ActionItem {
  return { id, text: text.trim().slice(0, 500), status: 'open', source: 'manual', createdAt: now, ...(owner?.trim() && { owner: owner.trim().slice(0, 40) }), ...(validDate(due) && { due }) }
}

export function validDate(d: string | undefined): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
}

/** Change a status, keeping doneAt in step with it. */
export function withStatus(a: ActionItem, status: ActionItem['status'], now: string): ActionItem {
  const { doneAt: _drop, ...rest } = a
  return status === 'done' ? { ...rest, status, doneAt: now } : { ...rest, status }
}

export function isOverdue(a: ActionItem, today: string): boolean {
  return a.status !== 'done' && !!a.due && a.due < today
}

/** Doing first, then open, then done; within a group, dated before undated, earliest first. */
export function sortActions(items: readonly ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (s) return s
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0
    if (a.due) return -1
    if (b.due) return 1
    return a.createdAt < b.createdAt ? -1 : 1
  })
}

export function actionCounts(items: readonly ActionItem[], today: string): { open: number; doing: number; done: number; overdue: number } {
  const c = { open: 0, doing: 0, done: 0, overdue: 0 }
  for (const a of items) {
    c[a.status] += 1
    if (isOverdue(a, today)) c.overdue += 1
  }
  return c
}
