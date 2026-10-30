import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { JanusApi } from '@shared/api'
import type { Evidence } from '@shared/evidence'
import { analysisDigest } from '@shared/evidence'
import { appendEntry } from '@shared/casechain'
import { adoptSteps as adopt, manualAction, withStatus } from '@shared/actions'
import {
  CASE_FILE_SCHEMA,
  emptyStore,
  mergeContribution,
  type ActionItem,
  type CaseFile,
  type Investigation,
  type InvestigationStore,
  type PlatformSettings,
  type Report
} from '@shared/investigation'
import type { IncidentWindow } from '@shared/januslog'
import type { VaultState } from '@shared/privacy'

// The platform's working state. Everything an investigation holds lives here, loaded from the case vault
// in the main process and written back (debounced) after each change. When the vault is sealed and locked
// nothing is held in the renderer at all.

export type LoadState = 'loading' | 'locked' | 'ready' | 'error'

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export interface NewInvestigationInput {
  title: string
  hypothesis: string
  incident?: IncidentWindow
  tag?: string
}

export interface CaseStoreApi {
  state: LoadState
  error: string | null
  saveError: string | null
  vault: VaultState
  /** True when running inside the desktop app. In a plain browser the platform works in memory only. */
  persistent: boolean
  store: InvestigationStore
  settings: PlatformSettings
  selectedId: string | null
  select: (id: string | null) => void
  /** A tab another screen wants the case view to open on (Home links straight into Analysis, say). */
  pendingTab: string | null
  openCase: (id: string, tab?: string) => void
  lockNow: () => Promise<void>
  updateSettings: (patch: (s: PlatformSettings) => PlatformSettings) => void
  createInvestigation: (input: NewInvestigationInput) => string
  updateInvestigation: (id: string, patch: Partial<Investigation>) => void
  deleteInvestigation: (id: string) => void
  addEvidence: (items: Evidence[], detail?: string) => void
  updateEvidence: (id: string, patch: Partial<Evidence>) => void
  removeEvidence: (id: string) => void
  setReport: (invId: string, report: Report) => void
  runAnalysis: (invId: string) => void
  logAction: (invId: string, action: string, detail: string) => void
  mergeFrom: (invId: string, file: CaseFile) => { added: number; duplicates: number }
  openAsNew: (file: CaseFile) => string
  buildCaseFile: (invId: string) => CaseFile | null
  actionsOf: (invId: string) => ActionItem[]
  /** Track the analysis's recommended steps. Steps already tracked are not added again. Returns how many were added. */
  trackSteps: (invId: string, steps: readonly string[]) => number
  addAction: (invId: string, text: string, owner?: string, due?: string) => void
  setActionStatus: (invId: string, id: string, status: ActionItem['status']) => void
  updateAction: (invId: string, id: string, patch: Partial<Pick<ActionItem, 'text' | 'owner' | 'due'>>) => void
  removeAction: (invId: string, id: string) => void
  /** Record a signer met on import (not yet trusted), or set whether you trust them. */
  noteSigner: (fingerprint: string, agent: string) => void
  trustSigner: (fingerprint: string, agent: string, trusted: boolean) => void
}

const Ctx = createContext<CaseStoreApi | null>(null)

export function useCases(): CaseStoreApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCases must be used inside CaseStoreProvider')
  return v
}

function bridge(): JanusApi | undefined {
  return (globalThis as unknown as { janus?: JanusApi }).janus
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

export function CaseStoreProvider({ children }: { children: ReactNode }) {
  const api = bridge()
  const persistent = !!api?.investigations && !!api?.vault
  const [state, setState] = useState<LoadState>(persistent ? 'loading' : 'ready')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [vault, setVault] = useState<VaultState>({ mode: 'plain', locked: false, keyfile: false, empty: true, waitMs: 0, failed: 0 })
  const [store, setStore] = useState<InvestigationStore>(emptyStore)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingTab, setPendingTab] = useState<string | null>(null)
  const dirty = useRef(false)
  const storeRef = useRef(store)
  storeRef.current = store
  const stateRef = useRef(state)
  stateRef.current = state

  const loadFromVault = useCallback(async () => {
    if (!api) return
    try {
      const loaded = await api.investigations.load()
      dirty.current = false
      setStore(loaded)
      setSelectedId((cur) => (cur && loaded.investigations.some((i) => i.id === cur) ? cur : (loaded.investigations[0]?.id ?? null)))
      setState('ready')
      setError(null)
    } catch (e) {
      setError(messageOf(e))
      setState('error')
    }
  }, [api])

  // First load: ask the vault what state it is in, then read it if it can be read.
  useEffect(() => {
    if (!api?.vault) return
    let cancelled = false
    ;(async () => {
      const s = await api.vault.state().catch(() => null)
      if (cancelled || !s) return
      setVault(s)
      if (s.locked) setState('locked')
      else await loadFromVault()
    })()
    return () => {
      cancelled = true
    }
  }, [api, loadFromVault])

  // The main process locks the vault after inactivity. When it does, drop everything held here.
  useEffect(() => {
    if (!api?.vault) return
    return api.vault.onChange((s) => {
      setVault(s)
      if (s.locked) {
        dirty.current = false
        setStore(emptyStore())
        // The selection is only a random id, so it is kept: unlocking returns to the same case.
        setState('locked')
      } else if (stateRef.current === 'locked') {
        void loadFromVault()
      }
    })
  }, [api, loadFromVault])

  // Tell the main process the analyst is active, so the auto-lock timer does not fire mid-work.
  useEffect(() => {
    if (!api?.vault) return
    let last = 0
    const poke = () => {
      const now = Date.now()
      if (now - last > 20_000) {
        last = now
        api.vault.touch()
      }
    }
    window.addEventListener('pointerdown', poke)
    window.addEventListener('keydown', poke)
    return () => {
      window.removeEventListener('pointerdown', poke)
      window.removeEventListener('keydown', poke)
    }
  }, [api])

  // Debounced save.
  useEffect(() => {
    if (!persistent || state !== 'ready' || !dirty.current) return
    const timer = setTimeout(() => {
      dirty.current = false
      api!.investigations
        .save(storeRef.current)
        .then(() => setSaveError(null))
        .catch((e) => {
          dirty.current = true
          setSaveError(messageOf(e))
        })
    }, 400)
    return () => clearTimeout(timer)
  }, [api, persistent, state, store])

  const update = useCallback((fn: (s: InvestigationStore) => InvestigationStore) => {
    dirty.current = true
    setStore(fn)
  }, [])

  const lockNow = useCallback(async () => {
    if (!api) return
    if (dirty.current) {
      dirty.current = false
      await api.investigations.save(storeRef.current).catch(() => {})
    }
    const s = await api.vault.lock()
    setVault(s)
    setStore(emptyStore())
    setState('locked')
  }, [api])

  const logAction = useCallback(
    (invId: string, action: string, detail: string) => {
      update((s) => ({
        ...s,
        logs: { ...s.logs, [invId]: appendEntry(s.logs[invId] ?? [], { actor: s.settings.agent, action, detail }) }
      }))
    },
    [update]
  )

  const value = useMemo<CaseStoreApi>(() => {
    const withLog = (s: InvestigationStore, invId: string, action: string, detail: string): InvestigationStore => ({
      ...s,
      logs: { ...s.logs, [invId]: appendEntry(s.logs[invId] ?? [], { actor: s.settings.agent, action, detail }) }
    })
    return {
      state,
      error,
      saveError,
      vault,
      persistent,
      store,
      settings: store.settings,
      selectedId,
      select: setSelectedId,
      pendingTab,
      openCase: (id, tab) => {
        setSelectedId(id)
        setPendingTab(tab ?? null)
      },
      lockNow,
      updateSettings: (patch) => update((s) => ({ ...s, settings: patch(s.settings) })),
      createInvestigation: (input) => {
        const inv: Investigation = {
          id: newId('inv'),
          title: input.title.trim(),
          hypothesis: input.hypothesis.trim(),
          lead: store.settings.agent,
          createdAt: new Date().toISOString(),
          incident: input.incident,
          tag: input.tag?.trim() || undefined,
          agents: [store.settings.agent]
        }
        update((s) => withLog({ ...s, investigations: [inv, ...s.investigations] }, inv.id, 'investigation:create', inv.title))
        setSelectedId(inv.id)
        return inv.id
      },
      updateInvestigation: (id, patch) => {
        update((s) => ({ ...s, investigations: s.investigations.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
      },
      deleteInvestigation: (id) => {
        update((s) => {
          const reports = { ...s.reports }
          const logs = { ...s.logs }
          const actions = { ...s.actions }
          delete reports[id]
          delete logs[id]
          delete actions[id]
          return {
            ...s,
            investigations: s.investigations.filter((i) => i.id !== id),
            evidence: s.evidence.filter((e) => e.investigationId !== id),
            reports,
            logs,
            actions
          }
        })
        setSelectedId((cur) => (cur === id ? (store.investigations.find((i) => i.id !== id)?.id ?? null) : cur))
      },
      addEvidence: (items, detail) => {
        if (items.length === 0) return
        const invId = items[0].investigationId
        update((s) => {
          let next: InvestigationStore = { ...s, evidence: [...s.evidence, ...items] }
          for (const it of items) next = withLog(next, invId, 'evidence:add', `${it.title}${it.fileSha256 ? ` · sha256 ${it.fileSha256.slice(0, 12)}…` : ''}`)
          if (detail) next = withLog(next, invId, 'intake', detail)
          const agents = new Set([...(next.investigations.find((i) => i.id === invId)?.agents ?? []), s.settings.agent])
          next.investigations = next.investigations.map((i) => (i.id === invId ? { ...i, agents: [...agents] } : i))
          return next
        })
      },
      updateEvidence: (id, patch) => {
        update((s) => ({ ...s, evidence: s.evidence.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
      },
      removeEvidence: (id) => {
        const gone = store.evidence.find((e) => e.id === id)
        update((s) => {
          const next = { ...s, evidence: s.evidence.filter((e) => e.id !== id) }
          return gone ? withLog(next, gone.investigationId, 'evidence:remove', gone.title) : next
        })
      },
      setReport: (invId, report) => update((s) => ({ ...s, reports: { ...s.reports, [invId]: report } })),
      runAnalysis: (invId) => {
        update((s) => {
          const inv = s.investigations.find((i) => i.id === invId)
          if (!inv) return s
          const ev = s.evidence.filter((e) => e.investigationId === invId)
          const stamp = { at: new Date().toISOString(), by: s.settings.agent, digest: analysisDigest(ev, inv.incident ?? null) }
          const next = { ...s, investigations: s.investigations.map((i) => (i.id === invId ? { ...i, analysis: stamp } : i)) }
          return withLog(next, invId, 'analysis:run', `${ev.length} item${ev.length === 1 ? '' : 's'} · digest ${stamp.digest.slice(0, 12)}…`)
        })
      },
      logAction,
      mergeFrom: (invId, file) => {
        const existing = store.evidence.filter((e) => e.investigationId === invId)
        const result = mergeContribution(existing, file.evidence, invId)
        update((s) => {
          let next: InvestigationStore = { ...s, evidence: [...s.evidence, ...result.added] }
          const agents = new Set([...(s.investigations.find((i) => i.id === invId)?.agents ?? []), ...result.agents, file.exportedBy ?? ''].filter(Boolean))
          next.investigations = next.investigations.map((i) => (i.id === invId ? { ...i, agents: [...agents] } : i))
          next = withLog(next, invId, 'case:merge', `${result.added.length} added, ${result.duplicates} already present · from ${file.exportedBy ?? 'another agent'} (${file.investigation.title})`)
          return next
        })
        return { added: result.added.length, duplicates: result.duplicates }
      },
      openAsNew: (file) => {
        const inv: Investigation = { ...file.investigation, id: store.investigations.some((i) => i.id === file.investigation.id) ? newId('inv') : file.investigation.id }
        const evidence = file.evidence.map((e) => ({ ...e, investigationId: inv.id, origin: e.origin ?? ('merge' as const) }))
        update((s) => {
          let next: InvestigationStore = {
            ...s,
            investigations: [inv, ...s.investigations],
            evidence: [...s.evidence, ...evidence],
            reports: file.report ? { ...s.reports, [inv.id]: file.report } : s.reports,
            logs: { ...s.logs, [inv.id]: file.log ?? [] }
          }
          next = withLog(next, inv.id, 'case:import', `${file.investigation.title}${file.exportedBy ? ` · from ${file.exportedBy}` : ''}${file.redaction ? ' · redacted copy' : ''}`)
          return next
        })
        setSelectedId(inv.id)
        return inv.id
      },
      actionsOf: (invId) => store.actions[invId] ?? [],
      trackSteps: (invId, steps) => {
        const r = adopt(store.actions[invId] ?? [], steps, () => newId('act'), new Date().toISOString())
        if (r.added === 0) return 0
        update((s) => withLog({ ...s, actions: { ...s.actions, [invId]: r.items } }, invId, 'actions:track', `${r.added} recommended step${r.added === 1 ? '' : 's'} added to the action list`))
        return r.added
      },
      addAction: (invId, text, owner, due) => {
        if (!text.trim()) return
        const item = manualAction(text, newId('act'), new Date().toISOString(), owner, due)
        update((s) => withLog({ ...s, actions: { ...s.actions, [invId]: [...(s.actions[invId] ?? []), item] } }, invId, 'action:add', item.text.slice(0, 120)))
      },
      setActionStatus: (invId, id, status) => {
        update((s) => {
          const list = s.actions[invId] ?? []
          const target = list.find((a) => a.id === id)
          if (!target || target.status === status) return s
          const next = { ...s, actions: { ...s.actions, [invId]: list.map((a) => (a.id === id ? withStatus(a, status, new Date().toISOString()) : a)) } }
          return withLog(next, invId, `action:${status}`, target.text.slice(0, 120))
        })
      },
      updateAction: (invId, id, patch) => {
        update((s) => ({ ...s, actions: { ...s.actions, [invId]: (s.actions[invId] ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) } }))
      },
      removeAction: (invId, id) => {
        update((s) => {
          const target = (s.actions[invId] ?? []).find((a) => a.id === id)
          const next = { ...s, actions: { ...s.actions, [invId]: (s.actions[invId] ?? []).filter((a) => a.id !== id) } }
          return target ? withLog(next, invId, 'action:remove', target.text.slice(0, 120)) : next
        })
      },
      noteSigner: (fingerprint, agent) => {
        if (store.signers[fingerprint]) return
        update((s) => ({ ...s, signers: { ...s.signers, [fingerprint]: { agent: agent.slice(0, 40), firstSeen: new Date().toISOString(), trusted: false } } }))
      },
      trustSigner: (fingerprint, agent, trusted) => {
        update((s) => ({ ...s, signers: { ...s.signers, [fingerprint]: { agent: (s.signers[fingerprint]?.agent ?? agent).slice(0, 40), firstSeen: s.signers[fingerprint]?.firstSeen ?? new Date().toISOString(), trusted } } }))
      },
      buildCaseFile: (invId) => {
        const inv = store.investigations.find((i) => i.id === invId)
        if (!inv) return null
        return {
          schema: CASE_FILE_SCHEMA,
          exportedAt: new Date().toISOString(),
          exportedBy: store.settings.agent,
          investigation: inv,
          evidence: store.evidence.filter((e) => e.investigationId === invId),
          report: store.reports[invId] ?? null,
          log: store.logs[invId] ?? []
        }
      }
    }
  }, [state, error, saveError, vault, persistent, store, selectedId, pendingTab, lockNow, update, logAction])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
