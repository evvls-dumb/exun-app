import { randomUUID } from 'node:crypto'
import Groq, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError
} from 'groq-sdk'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall
} from 'groq-sdk/resources/chat/completions'
import { AiError } from './errors'
import type {
  AgentSession,
  LlmProvider,
  ProviderEvent,
  ProviderRequest,
  ToolCall,
  ToolOutcome
} from './provider'

const MAX_COMPLETION_TOKENS = 2048
const MAX_RETRIES = 4
const TOOL_USE_RETRIES = 2

function isToolUseFailure(cause: unknown): boolean {
  if (!(cause instanceof APIError) || cause.status !== 400) return false
  const body = cause.error as { error?: { code?: string } } | undefined
  return body?.error?.code === 'tool_use_failed' || /tool_use_failed|failed to call a function/i.test(cause.message)
}

function translate(cause: unknown, signal: AbortSignal): AiError {
  if (cause instanceof AiError) return cause
  if (signal.aborted || cause instanceof APIUserAbortError) return new AiError('cancelled', 'Stopped.')
  if (cause instanceof AuthenticationError || cause instanceof PermissionDeniedError) {
    return new AiError('invalid_key', 'The Groq API key was rejected. Check it and try again.')
  }
  if (cause instanceof RateLimitError) {
    return new AiError('rate_limited', 'Groq is rate-limiting requests. Wait a moment and try again.')
  }
  if (cause instanceof APIConnectionError) {
    return new AiError('offline', 'Couldn’t reach Groq. Check your connection.')
  }
  if (cause instanceof APIError) {
    const detail = cause.status ?? cause.message.replace(/^\d+\s*/, '').slice(0, 160)
    return new AiError('failed', `Groq returned an error (${detail}).`)
  }
  return new AiError('failed', cause instanceof Error ? cause.message : 'Something went wrong.')
}

function parseArgs(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text || '{}')
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

class GroqSession implements AgentSession {
  private readonly messages: ChatCompletionMessageParam[]

  constructor(
    private readonly client: () => Promise<Groq>,
    private readonly request: ProviderRequest
  ) {
    this.messages = [
      { role: 'system', content: request.system },
      ...request.messages.map(({ role, content }) => ({ role, content }))
    ]
  }

  async *turn(
    outcomes: readonly ToolOutcome[],
    { allowTools }: { allowTools: boolean }
  ): AsyncGenerator<ProviderEvent, void, void> {
    const { model, tools, signal } = this.request
    for (const { call, output } of outcomes) {
      this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) })
    }

    try {
      const groq = await this.client()
      for (let attempt = 0; ; attempt += 1) {
        let text = ''
        const pending = new Map<number, { id: string; name: string; args: string }>()
        try {
          const stream = await groq.chat.completions.create(
            {
              model,
              messages: this.messages,
              max_completion_tokens: MAX_COMPLETION_TOKENS,
              reasoning_effort: 'low',
              stream: true,
              ...(tools.length > 0 && {
                tools: tools.map(({ name, description, parameters }) => ({
                  type: 'function' as const,
                  function: { name, description, parameters }
                })),
                tool_choice: allowTools ? ('auto' as const) : ('none' as const),
                parallel_tool_calls: true
              })
            },
            { signal }
          )

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta
            if (!delta) continue
            if (delta.content) {
              text += delta.content
              yield { type: 'text', text: delta.content }
            }
            for (const piece of delta.tool_calls ?? []) {
              const call = pending.get(piece.index) ?? { id: '', name: '', args: '' }
              if (piece.id) call.id = piece.id
              if (piece.function?.name) call.name += piece.function.name
              if (piece.function?.arguments) call.args += piece.function.arguments
              pending.set(piece.index, call)
            }
          }
        } catch (cause) {
          if (!signal.aborted && isToolUseFailure(cause) && !text && attempt < TOOL_USE_RETRIES) continue
          throw cause
        }
        if (signal.aborted) throw new AiError('cancelled', 'Stopped.')

        const calls: ToolCall[] = [...pending.values()].map((call) => ({
          id: call.id || randomUUID(),
          name: call.name,
          args: parseArgs(call.args)
        }))
        const toolCalls: ChatCompletionMessageToolCall[] = calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) }
        }))
        this.messages.push({
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls })
        })
        for (const call of calls) yield { type: 'call', call }
        return
      }
    } catch (cause) {
      throw translate(cause, signal)
    }
  }
}

export class GroqProvider implements LlmProvider {
  private client: { key: string; groq: Groq } | null = null

  constructor(private readonly getApiKey: () => Promise<string | null>) {}

  private async clientFor(): Promise<Groq> {
    const key = await this.getApiKey()
    if (!key) throw new AiError('no_key', 'Add a Groq API key to start chatting.')
    if (this.client?.key !== key) this.client = { key, groq: new Groq({ apiKey: key, maxRetries: MAX_RETRIES }) }
    return this.client.groq
  }

  start(request: ProviderRequest): AgentSession {
    return new GroqSession(() => this.clientFor(), request)
  }
}
