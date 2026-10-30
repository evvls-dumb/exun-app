import type {
  AiEvent,
  AiKeyResult,
  AiStatus,
  Conversation,
  ConversationSummary,
  SendRequest
} from './ai'
import type { Session } from './session'
import type { CaseFile, InvestigationStore } from './investigation'
import type { IntakeBatch } from './intake'
import type { Prefs } from './prefs'
import type { AuthResult, Credentials, SetupRequest, VaultState } from './privacy'

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

export interface JanusInvestigationsApi {
  load: () => Promise<InvestigationStore>
  save: (store: InvestigationStore) => Promise<void>
  /** Write a case file. With a passphrase the file is sealed. Redaction is applied before this call. */
  /** Save a case file. `sign` signs it with this agent's identity (the vault must be unlocked). */
  exportCase: (file: CaseFile, passphrase?: string, sign?: boolean) => Promise<string | null>
  exportPdf: (title: string, html: string) => Promise<string | null>
}

export interface JanusVaultApi {
  state: () => Promise<VaultState>
  /** First run: create the vault. Resolves with the recovery key, shown once. */
  setup: (req: SetupRequest) => Promise<AuthResult>
  unlock: (req: Credentials) => Promise<AuthResult>
  unlockWithRecovery: (recoveryKey: string) => Promise<AuthResult>
  lock: () => Promise<VaultState>
  change: (current: Credentials, next: Credentials) => Promise<VaultState>
  newRecovery: (current: Credentials) => Promise<AuthResult>
  /** Crypto-erase everything. The phrase DESTROY must be typed. */
  destroy: (phrase: string) => Promise<VaultState>
  /** The security event log: setups, unlocks, wrong guesses, locks. */
  securityLog: () => Promise<SecurityLog>
  /** This agent's signing identity. Needs the vault to be unlocked. */
  identity: () => Promise<AgentIdentity>
  /** Save an encrypted copy of the vault. Returns where it went, or null if cancelled. */
  backup: () => Promise<string | null>
  /** Replace the vault with a backup. The phrase RESTORE is required when a vault is already open. */
  restore: (phrase?: string) => Promise<VaultState | null>
  createKeyfile: () => Promise<string | null>
  pickKeyfile: () => Promise<string | null>
  /** Save the recovery key shown at setup as a text file. Returns where it went, or null if cancelled. */
  saveRecoveryKey: (recoveryKey: string) => Promise<string | null>
  /** Tell the main process the analyst is active, so the auto-lock timer restarts. */
  touch: () => void
  onChange: (listener: (state: VaultState) => void) => () => void
}

export interface JanusIntakeApi {
  /** Open the system picker. Returns the chosen paths, or none if cancelled. */
  pick: (what: 'files' | 'folder') => Promise<string[]>
  /** Read, hash, verify and analyse what was chosen. Files are only read, never changed. */
  ingest: (paths: string[], passphrase?: string) => Promise<IntakeBatch>
  /** The on-disk paths of files dropped onto the window. */
  pathsOf: (files: File[]) => string[]
}

export interface SecurityLog {
  entries: { seq: number; time: string; event: string; detail: string }[]
  intact: boolean
  brokenAt?: number
  earlierDropped: boolean
}

export interface AgentIdentity {
  fingerprint: string
  created: string
}

export interface JanusPrefsApi {
  get: () => Promise<Prefs>
  set: (patch: Partial<Prefs>) => Promise<Prefs>
}

export interface JanusApi {
  detectLogsFile: () => Promise<string | null>
  investigations: JanusInvestigationsApi
  vault: JanusVaultApi
  prefs: JanusPrefsApi
  intake: JanusIntakeApi
  sessions: {
    list: () => Promise<Session[]>
    create: (logsPath: string) => Promise<Session>
    open: (id: string) => Promise<Session>
  }
  ai: JanusAiApi
}
