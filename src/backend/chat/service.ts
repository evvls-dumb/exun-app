import { randomUUID } from 'node:crypto'
import type { AgentStep, AiEvent, Attachment, ChatMessage, Conversation, SendRequest } from '../../shared/ai'
import { analyseLog } from '../../shared/meter'
import { buildSystemPrompt } from '../agent/prompt'
import type { NoteStore } from '../agent/notes'
import { TOOL_SPECS, ToolInputError, runTool, toolLabel, type FileSink, type ToolContext } from '../agent/tools'
import { AiError, toAiError } from '../ai/errors'
import { MODEL_IDS } from '../ai/models'
import type { LlmProvider, ProviderMessage, ToolCall, ToolOutcome } from '../ai/provider'
import { ConversationStore, createMessage } from './store'

const MAX_HISTORY_MESSAGES = 30
const MAX_TOOL_ROUNDS = 8

function historyFor(conversation: Conversation): ProviderMessage[] {
  const recent = conversation.messages.slice(-MAX_HISTORY_MESSAGES)
  const start = recent.findIndex((message) => message.role === 'user')
  return recent.slice(start < 0 ? recent.length : start).map(({ role, content, attachments }) => {
    const made = attachments?.filter((item) => item.kind === 'file').map((item) => item.name) ?? []
    return { role, content: made.length ? `${content}\n\n(Files created: ${made.join(', ')})` : content }
  })
}

function fallbackReply(attachments: readonly Attachment[]): string {
  const files = attachments.filter((item) => item.kind === 'file').map((item) => item.name)
  return files.length ? `Done. Created ${files.join(', ')}.` : 'Done.'
}

export class ChatService {
  private readonly runs = new Map<string, AbortController>()

  constructor(
    private readonly provider: LlmProvider,
    private readonly store: ConversationStore,
    private readonly files: FileSink,
    private readonly notes: NoteStore
  ) {}

  send(request: SendRequest, emit: (event: AiEvent) => void): string {
    const runId = randomUUID()
    const controller = new AbortController()
    this.runs.set(runId, controller)

    void this.run(runId, request, controller.signal, emit).finally(() => this.runs.delete(runId))
    return runId
  }

  cancel(runId: string): void {
    this.runs.get(runId)?.abort()
  }

  private async run(
    runId: string,
    request: SendRequest,
    signal: AbortSignal,
    emit: (event: AiEvent) => void
  ): Promise<void> {
    let conversationId = request.conversationId ?? ''

    try {
      let conversation = request.conversationId ? await this.store.get(request.conversationId) : null
      if (request.conversationId && !conversation) {
        throw new AiError('failed', 'That conversation no longer exists.')
      }
      conversation ??= await this.store.create()
      conversationId = conversation.id

      const last = conversation.messages.at(-1)
      let userMessage: ChatMessage
      if (request.retry && last?.role === 'user') {
        userMessage = last
      } else {
        userMessage = createMessage('user', request.text)
        conversation = await this.store.append(conversation.id, userMessage)
      }
      emit({ type: 'started', runId, conversation: this.store.summary(conversation), userMessage })

      const today = request.caseData?.today ?? new Date().toISOString().slice(0, 10)
      const agent = request.mode === 'agent' && request.caseData !== undefined
      const context: ToolContext | null = agent
        ? { analysis: analyseLog(today, request.caseData!.entries), files: this.files, notes: this.notes }
        : null

      let reply = ''
      const steps: AgentStep[] = []
      const attachments: Attachment[] = []

      const runCall = async (call: ToolCall): Promise<ToolOutcome> => {
        const step: AgentStep = {
          id: call.id,
          tool: call.name,
          label: toolLabel(call.name, call.args),
          status: 'running'
        }
        steps.push(step)
        emit({ type: 'step', runId, conversationId, step: { ...step } })
        const started = Date.now()
        try {
          if (!context) throw new ToolInputError('Tools are not available in this mode.')
          const result = await runTool(call.name, call.args, context)
          step.status = 'done'
          step.summary = result.summary
          if (result.attachment) {
            attachments.push(result.attachment)
            emit({ type: 'attachment', runId, conversationId, attachment: result.attachment })
          }
          return { call, output: result.output }
        } catch (cause) {
          step.status = 'error'
          step.summary = cause instanceof ToolInputError ? cause.message : 'The tool failed.'
          return { call, output: { error: step.summary } }
        } finally {
          step.durationMs = Date.now() - started
          emit({ type: 'step', runId, conversationId, step: { ...step } })
        }
      }

      try {
        const session = this.provider.start({
          model: MODEL_IDS[request.model],
          system: buildSystemPrompt(request.mode, today),
          messages: historyFor(conversation),
          tools: context ? TOOL_SPECS : [],
          signal
        })

        let outcomes: ToolOutcome[] = []
        for (let round = 0; ; round += 1) {
          const calls: ToolCall[] = []
          for await (const event of session.turn(outcomes, { allowTools: round < MAX_TOOL_ROUNDS })) {
            if (event.type === 'call') {
              calls.push(event.call)
            } else {
              reply += event.text
              emit({ type: 'delta', runId, conversationId, text: event.text })
            }
          }
          if (calls.length === 0) break

          outcomes = []
          for (const call of calls) {
            if (signal.aborted) throw new AiError('cancelled', 'Stopped.')
            outcomes.push(await runCall(call))
          }
          if (reply && !reply.endsWith('\n\n')) {
            const gap = reply.endsWith('\n') ? '\n' : '\n\n'
            reply += gap
            emit({ type: 'delta', runId, conversationId, text: gap })
          }
        }
      } catch (cause) {
        const error = toAiError(cause)
        if (!(error.code === 'cancelled' && (reply.trim() || steps.length))) throw error
      }

      reply = reply.trim()
      if (!reply && steps.length === 0) throw new AiError('failed', 'The model returned an empty reply.')

      const message: ChatMessage = {
        ...createMessage('assistant', reply || fallbackReply(attachments)),
        ...(steps.length > 0 && { steps }),
        ...(attachments.length > 0 && { attachments })
      }
      conversation = await this.store.append(conversation.id, message)
      emit({ type: 'done', runId, conversation: this.store.summary(conversation), message })
    } catch (cause) {
      const error = toAiError(cause)
      emit({ type: 'error', runId, conversationId, code: error.code, message: error.message })
    }
  }
}
