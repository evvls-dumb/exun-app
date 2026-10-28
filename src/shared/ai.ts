import type { MeterEntry } from './meter'

export type ChatRole = 'user' | 'assistant'

export type StepStatus = 'running' | 'done' | 'error'

export interface AgentStep {
  id: string
  tool: string
  label: string
  status: StepStatus
  summary?: string
  durationMs?: number
}

export type ChartMetric = 'usage' | 'meter_change' | 'reading' | 'load_kw' | 'cabinet_wh' | 'cabinet_peak_c'

export interface ChartPoint {
  date: string
  value: number
  flagged: boolean
  tone?: 'spike' | 'flag'
}

export interface ChartSpec {
  title: string
  metric: ChartMetric
  unit: string
  kind: 'bar' | 'line'
  points: ChartPoint[]
  baseline: number | null
}

export type Attachment =
  | { kind: 'chart'; id: string; chart: ChartSpec }
  | {
      kind: 'file'
      id: string
      format: 'pdf' | 'csv'
      name: string
      path: string
      bytes: number
      description: string
    }

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  steps?: AgentStep[]
  attachments?: Attachment[]
}

export interface ConversationSummary {
  id: string
  title: string
  preview: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

export type AiMode = 'agent' | 'chat'
export type AiModelChoice = 'auto' | 'fast'

export const AI_MODE_OPTIONS: readonly { value: AiMode; label: string; hint: string }[] = [
  { value: 'agent', label: 'Agent', hint: 'Investigates the meter log and the cabinet' },
  { value: 'chat', label: 'Chat', hint: 'General assistant, no case data' }
]

export const AI_MODEL_OPTIONS: readonly { value: AiModelChoice; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Most capable, best for investigations' },
  { value: 'fast', label: 'Fast', hint: 'Quicker and cheaper for simple questions' }
]

export interface CaseData {
  entries: MeterEntry[]
  today: string
  sessionId?: string
}

export const MAX_MESSAGE_CHARS = 8_000

export interface SendRequest {
  conversationId: string | null
  text: string
  mode: AiMode
  model: AiModelChoice
  caseData?: CaseData
  retry?: boolean
}

export type AiErrorCode =
  | 'no_key'
  | 'invalid_key'
  | 'rate_limited'
  | 'offline'
  | 'refused'
  | 'cancelled'
  | 'failed'

export type AiEvent =
  | {
      type: 'started'
      runId: string
      conversation: ConversationSummary
      userMessage: ChatMessage
    }
  | { type: 'delta'; runId: string; conversationId: string; text: string }
  | { type: 'step'; runId: string; conversationId: string; step: AgentStep }
  | { type: 'attachment'; runId: string; conversationId: string; attachment: Attachment }
  | {
      type: 'done'
      runId: string
      conversation: ConversationSummary
      message: ChatMessage
    }
  | {
      type: 'error'
      runId: string
      conversationId: string
      code: AiErrorCode
      message: string
    }

export interface AiKeyResult {
  status: AiStatus
  error: string | null
}

export interface AiStatus {
  configured: boolean
  source: 'stored' | 'env' | null
  canStoreKey: boolean
}
