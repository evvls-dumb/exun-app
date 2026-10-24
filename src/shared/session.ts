export interface StoredSession {
  id: string
  logsPath: string
  createdAt: string
  lastOpenedAt: string
}

export interface Session extends StoredSession {
  available: boolean
}
