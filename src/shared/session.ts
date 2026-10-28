export interface StoredSession {
  id: string
  logsPath: string
  createdAt: string
  lastOpenedAt: string
  fingerprint?: string
  sealedAt?: string
  machineTitle?: string
  site?: string
}

export interface Session extends StoredSession {
  available: boolean
}
