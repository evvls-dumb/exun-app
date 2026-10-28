import { readFile } from 'node:fs/promises'
import { parseJanusLog, type JanusLog } from '../../shared/janus'
import { analyseMachine, type EvidenceSeal, type MachineAnalysis, type MachineCase, type MachineReport } from '../../shared/machine'
import { fingerprintOf, getSession, sealSession } from '../sessions/store'

const MAX_CACHED = 4

interface LoadedLog {
  fingerprint: string
  log: JanusLog
  analysis: MachineAnalysis
}

const cache = new Map<string, LoadedLog>()

async function load(path: string): Promise<LoadedLog> {
  const data = await readFile(path)
  const fingerprint = fingerprintOf(data)
  const cached = cache.get(fingerprint)
  if (cached) return cached

  const log = parseJanusLog(data.toString('utf8'))
  const loaded = { fingerprint, log, analysis: analyseMachine(log) }
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string)
  cache.set(fingerprint, loaded)
  return loaded
}

async function sealFor(sessionId: string, loaded: LoadedLog): Promise<EvidenceSeal> {
  let session = await getSession(sessionId)
  if (!session.fingerprint || !session.sealedAt) {
    const { title, site } = loaded.analysis.machine
    session = await sealSession(sessionId, loaded.fingerprint, title, site)
  }
  return {
    algorithm: 'SHA-256',
    fingerprint: session.fingerprint as string,
    current: loaded.fingerprint,
    sealedAt: session.sealedAt as string,
    checkedAt: new Date().toISOString(),
    intact: session.fingerprint === loaded.fingerprint
  }
}

export async function loadCase(sessionId: string): Promise<MachineCase> {
  const { logsPath } = await getSession(sessionId)
  const loaded = await load(logsPath)
  return {
    log: loaded.log,
    analysis: loaded.analysis,
    seal: await sealFor(sessionId, loaded),
    verify: async () => sealFor(sessionId, await load(logsPath))
  }
}

export async function machineReport(sessionId: string): Promise<MachineReport> {
  const { analysis, seal } = await loadCase(sessionId)
  return { analysis, seal }
}
