import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentStep,
  AiErrorCode,
  AiMode,
  AiModelChoice,
  AiStatus,
  Attachment,
  CaseData,
  ChatMessage,
  ConversationSummary
} from '@shared/ai'

export interface ChatError {
  code: AiErrorCode
  message: string
}

export interface SendOptions {
  mode: AiMode
  model: AiModelChoice
  caseData?: CaseData
}

export interface PendingReply {
  text: string
  steps: AgentStep[]
  attachments: Attachment[]
}

const EMPTY_REPLY: PendingReply = { text: '', steps: [], attachments: [] }

function upsert(list: ConversationSummary[], summary: ConversationSummary): ConversationSummary[] {
  return [summary, ...list.filter((item) => item.id !== summary.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )
}

export function useChat() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reply, setReply] = useState<PendingReply | null>(null)
  const [error, setError] = useState<ChatError | null>(null)

  const activeRef = useRef(activeId)
  const runRef = useRef<{ runId: string; conversationId: string } | null>(null)

  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

  useEffect(() => {
    const { ai } = window.janus
    let current = true

    Promise.all([ai.status(), ai.conversations.list()]).then(([nextStatus, list]) => {
      if (!current) return
      setStatus(nextStatus)
      setConversations(list)
    })

    const stop = ai.onEvent((event) => {
      if (event.type === 'started') {
        runRef.current = { runId: event.runId, conversationId: event.conversation.id }
        setConversations((list) => upsert(list, event.conversation))
        if (activeRef.current === null) {
          activeRef.current = event.conversation.id
          setActiveId(event.conversation.id)
        }
        if (activeRef.current === event.conversation.id) {
          setMessages((list) =>
            list.some((message) => message.id === event.userMessage.id)
              ? list
              : [...list, event.userMessage]
          )
        }
        return
      }

      const run = runRef.current
      const visible = run !== null && activeRef.current === run.conversationId

      if (event.type === 'delta') {
        if (visible) setReply((current) => current && { ...current, text: current.text + event.text })
      } else if (event.type === 'step') {
        const { step } = event
        if (visible) {
          setReply(
            (current) =>
              current && {
                ...current,
                steps: current.steps.some((item) => item.id === step.id)
                  ? current.steps.map((item) => (item.id === step.id ? step : item))
                  : [...current.steps, step]
              }
          )
        }
      } else if (event.type === 'attachment') {
        const { attachment } = event
        if (visible) {
          setReply((current) => current && { ...current, attachments: [...current.attachments, attachment] })
        }
      } else if (event.type === 'done') {
        setConversations((list) => upsert(list, event.conversation))
        if (visible) setMessages((list) => [...list, event.message])
        runRef.current = null
        setReply(null)
      } else {
        runRef.current = null
        setReply(null)
        if (event.code !== 'cancelled') setError({ code: event.code, message: event.message })
        if (event.code === 'no_key' || event.code === 'invalid_key') {
          ai.status().then(setStatus)
        }
      }
    })

    return () => {
      current = false
      stop()
    }
  }, [])

  const running = reply !== null

  const send = useCallback(
    async (text: string, options: SendOptions, retry = false) => {
      if (runRef.current || reply !== null) return
      setError(null)
      setReply(EMPTY_REPLY)
      try {
        await window.janus.ai.send({
          conversationId: activeRef.current,
          text,
          retry,
          ...options
        })
      } catch {
        setReply(null)
        setError({ code: 'failed', message: 'That message couldn’t be sent.' })
      }
    },
    [reply]
  )

  const retry = useCallback(
    (options: SendOptions) => {
      const lastUser = [...messages].reverse().find((message) => message.role === 'user')
      if (lastUser) void send(lastUser.content, options, true)
    },
    [messages, send]
  )

  const cancel = useCallback(() => {
    const run = runRef.current
    if (run) void window.janus.ai.cancel(run.runId)
  }, [])

  const select = useCallback(async (id: string) => {
    const conversation = await window.janus.ai.conversations.get(id)
    activeRef.current = id
    setActiveId(id)
    setMessages(conversation?.messages ?? [])
    setError(null)
  }, [])

  const startNew = useCallback(() => {
    activeRef.current = null
    setActiveId(null)
    setMessages([])
    setError(null)
  }, [])

  const remove = useCallback(
    async (id: string) => {
      await window.janus.ai.conversations.remove(id)
      setConversations((list) => list.filter((item) => item.id !== id))
      if (activeRef.current === id) startNew()
    },
    [startNew]
  )

  const saveKey = useCallback(async (key: string): Promise<string | null> => {
    const result = await window.janus.ai.setKey(key)
    setStatus(result.status)
    if (!result.error) setError(null)
    return result.error
  }, [])

  const clearKey = useCallback(async () => {
    setStatus(await window.janus.ai.clearKey())
  }, [])

  return {
    status,
    conversations,
    activeId,
    messages,
    reply,
    running,
    error,
    dismissError: () => setError(null),
    send,
    retry,
    cancel,
    select,
    startNew,
    remove,
    saveKey,
    clearKey
  }
}
