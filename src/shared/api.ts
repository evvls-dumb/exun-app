import type {
  AiEvent,
  AiKeyResult,
  AiStatus,
  Conversation,
  ConversationSummary,
  SendRequest
} from './ai'
import type { MachineReport } from './machine'
import type { Session } from './session'

export interface JanusAiApi {
  status: () => Promise<AiStatus>
  setKey: (key: string) => Promise<AiKeyResult>
  clearKey: () => Promise<AiStatus>
  conversations: {
    list: () => Promise<ConversationSummary[]>
    get: (id: string) => Promise<Conversation | null>
    remove: (id: string) => Promise<void>
  }
  send: (request: SendRequest) => Promise<string>
  cancel: (runId: string) => Promise<void>
  openFile: (path: string, reveal: boolean) => Promise<boolean>
  onEvent: (listener: (event: AiEvent) => void) => () => void
}

export interface JanusApi {
  detectLogsFile: () => Promise<string | null>
  sessions: {
    list: () => Promise<Session[]>
    create: (logsPath: string) => Promise<Session>
    open: (id: string) => Promise<Session>
  }
  machine: {
    report: (sessionId: string) => Promise<MachineReport>
  }
  ai: JanusAiApi
}
