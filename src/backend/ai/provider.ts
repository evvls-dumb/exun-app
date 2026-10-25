export interface ProviderMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolOutcome {
  call: ToolCall
  output: Record<string, unknown>
}

export interface ProviderRequest {
  model: string
  system: string
  messages: readonly ProviderMessage[]
  tools: readonly ToolSpec[]
  signal: AbortSignal
}

export type ProviderEvent = { type: 'text'; text: string } | { type: 'call'; call: ToolCall }

export interface AgentSession {
  turn(
    outcomes: readonly ToolOutcome[],
    options: { allowTools: boolean }
  ): AsyncGenerator<ProviderEvent, void, void>
}

export interface LlmProvider {
  start(request: ProviderRequest): AgentSession
}
