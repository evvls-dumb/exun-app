import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Session, StoredSession } from '../../shared/session'

const STORE_FILE = 'sessions.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

async function readAll(): Promise<StoredSession[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(storePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeAll(sessions: StoredSession[]): Promise<void> {
  await writeFile(storePath(), JSON.stringify(sessions, null, 2))
}

function withAvailability(session: StoredSession): Session {
  return { ...session, available: existsSync(session.logsPath) }
}

export async function listSessions(): Promise<Session[]> {
  const sessions = await readAll()
  return sessions
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .map(withAvailability)
}

export async function createSession(logsPath: string): Promise<Session> {
  const info = await stat(logsPath)
  if (!info.isFile()) throw new Error('The logs path must be a file')

  const now = new Date().toISOString()
  const session: StoredSession = {
    id: randomUUID(),
    logsPath,
    createdAt: now,
    lastOpenedAt: now
  }

  await writeAll([...(await readAll()), session])
  return withAvailability(session)
}

export async function openSession(id: string): Promise<Session> {
  const sessions = await readAll()
  const session = sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('Session not found')

  session.lastOpenedAt = new Date().toISOString()
  await writeAll(sessions)
  return withAvailability(session)
}
