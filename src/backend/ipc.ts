import { ipcMain, shell } from 'electron'
import { MAX_MESSAGE_CHARS, type AiKeyResult, type AiMode, type AiModelChoice, type CaseData, type SendRequest } from '../shared/ai'
import { IPC } from '../shared/ipc'
import { AiError } from './ai/errors'
import type { CredentialStore } from './ai/credentials'
import type { ChatService } from './chat/service'
import type { ConversationStore } from './chat/store'
import type { ReportFiles } from './reports/files'

const MAX_ENTRIES = 5_000
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MODES: readonly AiMode[] = ['agent', 'chat']
const MODELS: readonly AiModelChoice[] = ['auto', 'fast']

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function parseCaseData(value: unknown): CaseData | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) throw new TypeError('caseData must be an object')
  const input = value as Record<string, unknown>
  const today = input['today']
  const entries = input['entries']
  if (typeof today !== 'string' || !DATE.test(today)) throw new TypeError('caseData.today must be YYYY-MM-DD')
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > MAX_ENTRIES) {
    throw new TypeError('caseData.entries must hold 2 to 5000 records')
  }
  return {
    today,
    entries: entries.map((entry) => {
      const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
      const { date, reading, usage } = record
      if (typeof date !== 'string' || !DATE.test(date)) throw new TypeError('entry date must be YYYY-MM-DD')
      if (typeof reading !== 'number' || !Number.isFinite(reading)) throw new TypeError('entry reading must be a number')
      if (typeof usage !== 'number' || !Number.isFinite(usage)) throw new TypeError('entry usage must be a number')
      return { date, reading, usage }
    })
  }
}

function parseSendRequest(value: unknown): SendRequest {
  if (typeof value !== 'object' || value === null) throw new TypeError('request must be an object')
  const input = value as Record<string, unknown>

  const text = requireString(input['text'], 'text')
  if (text.length > MAX_MESSAGE_CHARS) throw new TypeError('message is too long')

  const conversationId = input['conversationId']
  if (conversationId !== null && typeof conversationId !== 'string') {
    throw new TypeError('conversationId must be a string or null')
  }
  const mode = input['mode'] as AiMode
  const model = input['model'] as AiModelChoice
  if (!MODES.includes(mode)) throw new TypeError('unknown mode')
  if (!MODELS.includes(model)) throw new TypeError('unknown model')

  return {
    conversationId: conversationId || null,
    text,
    mode,
    model,
    caseData: parseCaseData(input['caseData']),
    retry: input['retry'] === true
  }
}

interface AiBackend {
  service: ChatService
  conversations: ConversationStore
  credentials: CredentialStore
  files: ReportFiles
}

export function registerAiIpc({ service, conversations, credentials, files }: AiBackend): void {
  ipcMain.handle(IPC.aiStatus, () => credentials.status())

  ipcMain.handle(IPC.aiSetKey, async (_event, key: unknown): Promise<AiKeyResult> => {
    try {
      await credentials.setKey(requireString(key, 'key'))
      return { status: await credentials.status(), error: null }
    } catch (cause) {
      const error = cause instanceof AiError ? cause.message : 'The key couldn’t be saved.'
      return { status: await credentials.status(), error }
    }
  })

  ipcMain.handle(IPC.aiClearKey, async () => {
    await credentials.clearKey()
    return credentials.status()
  })

  ipcMain.handle(IPC.aiList, () => conversations.list())

  ipcMain.handle(IPC.aiGet, (_event, id: unknown) => conversations.get(requireString(id, 'id')))

  ipcMain.handle(IPC.aiRemove, (_event, id: unknown) => conversations.remove(requireString(id, 'id')))

  ipcMain.handle(IPC.aiSend, (event, request: unknown) => {
    const parsed = parseSendRequest(request)
    const sender = event.sender
    return service.send(parsed, (aiEvent) => {
      if (!sender.isDestroyed()) sender.send(IPC.aiEvent, aiEvent)
    })
  })

  ipcMain.handle(IPC.aiCancel, (_event, runId: unknown) => {
    service.cancel(requireString(runId, 'runId'))
  })

  ipcMain.handle(IPC.aiOpenFile, async (_event, path: unknown, reveal: unknown): Promise<boolean> => {
    const target = requireString(path, 'path')
    if (!files.contains(target)) return false
    if (reveal === true) {
      shell.showItemInFolder(target)
      return true
    }
    return (await shell.openPath(target)) === ''
  })
}
