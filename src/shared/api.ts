import type { Session } from './session'

export interface JanusApi {
  detectLogsFile: () => Promise<string | null>
  sessions: {
    list: () => Promise<Session[]>
    create: (logsPath: string) => Promise<Session>
    open: (id: string) => Promise<Session>
  }
}
