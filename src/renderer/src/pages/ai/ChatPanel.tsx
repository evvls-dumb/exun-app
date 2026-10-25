import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import DotSphere from '@/components/DotSphere'
import { AGENT_CODENAME } from '@/config'
import type { ChatError, PendingReply } from '@/hooks/useChat'
import type { AgentStep, Attachment, ChatMessage } from '@shared/ai'
import AgentTrace from './AgentTrace'
import Attachments from './Attachments'
import KeySetup from './KeySetup'
import Markdown from './Markdown'
import styles from './ChatPanel.module.css'

const NEAR_BOTTOM_PX = 96
const RETRYABLE: readonly ChatError['code'][] = ['rate_limited', 'offline', 'failed']
const WELCOME = `Let’s Dive, ${AGENT_CODENAME}`
const TYPE_START_MS = 250
const TYPE_STEP_MS = 65

function useTypewriter(text: string): string {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length)
      return
    }
    setCount(0)
    let timer = window.setTimeout(function step() {
      setCount((current) => {
        if (current + 1 < text.length) timer = window.setTimeout(step, TYPE_STEP_MS)
        return current + 1
      })
    }, TYPE_START_MS)
    return () => window.clearTimeout(timer)
  }, [text])

  return text.slice(0, count)
}

interface AssistantTurnProps {
  text: string
  steps: readonly AgentStep[]
  attachments: readonly Attachment[]
  live: boolean
}

function AssistantTurn({ text, steps, attachments, live }: AssistantTurnProps) {
  const toolRunning = steps.some((step) => step.status === 'running')
  return (
    <li className={styles.turn}>
      {steps.length > 0 && <AgentTrace steps={steps} live={live} />}
      <Attachments items={attachments} />
      {text ? (
        <div className={styles.bubble}>
          <Markdown text={text} />
        </div>
      ) : (
        live &&
        !toolRunning && (
          <div className={styles.thinking} role="status" aria-label="Janus is thinking">
            <DotSphere size={26} />
            <span className={styles.thinkingText} aria-hidden="true">
              Thinking
            </span>
          </div>
        )
      )}
    </li>
  )
}

interface ChatPanelProps {
  title: string
  messages: readonly ChatMessage[]
  reply: PendingReply | null
  error: ChatError | null
  needsKey: boolean
  canStoreKey: boolean
  canChangeKey: boolean
  suggestions: readonly string[]
  onSuggest: (text: string) => void
  onRetry: () => void
  onDismissError: () => void
  onChangeKey: () => void
  onSaveKey: (key: string) => Promise<string | null>
  footer: ReactNode
}

export default function ChatPanel({
  title,
  messages,
  reply,
  error,
  needsKey,
  canStoreKey,
  canChangeKey,
  suggestions,
  onSuggest,
  onRetry,
  onDismissError,
  onChangeKey,
  onSaveKey,
  footer
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const empty = messages.length === 0 && reply === null
  const typed = useTypewriter(WELCOME)
  const typedAll = typed.length === WELCOME.length

  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller && stickRef.current) scroller.scrollTop = scroller.scrollHeight
  }, [messages, reply, error])

  useEffect(() => {
    stickRef.current = true
  }, [title])

  function handleScroll() {
    const scroller = scrollRef.current
    if (!scroller) return
    stickRef.current =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX
  }

  return (
    <section className={styles.panel} aria-label="Chat">
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
      </header>

      {needsKey ? (
        <KeySetup canStoreKey={canStoreKey} onSave={onSaveKey} />
      ) : (
        <div ref={scrollRef} className={styles.scroll} onScroll={handleScroll}>
          {empty ? (
            <div className={styles.welcome}>
              <h3 className={styles.heading} aria-label={WELCOME}>
                <span aria-hidden="true">{typed}</span>
                <span
                  className={styles.caret}
                  data-done={typedAll || undefined}
                  aria-hidden="true"
                />
              </h3>
              <p className={styles.sub} data-visible={typedAll || undefined}>
                Ask about the loaded meter records. Janus answers from the data and won’t guess at
                causes it can’t show.
              </p>
              <ul className={styles.suggestions} data-visible={typedAll || undefined}>
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      className={styles.suggestion}
                      type="button"
                      onClick={() => onSuggest(suggestion)}
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className={styles.messages} aria-live="polite">
              {messages.map((message) =>
                message.role === 'assistant' ? (
                  <AssistantTurn
                    key={message.id}
                    text={message.content}
                    steps={message.steps ?? []}
                    attachments={message.attachments ?? []}
                    live={false}
                  />
                ) : (
                  <li key={message.id} className={styles.message} data-role="user">
                    <div className={styles.bubble}>
                      <p className={styles.userText}>{message.content}</p>
                    </div>
                  </li>
                )
              )}

              {reply && (
                <AssistantTurn
                  text={reply.text}
                  steps={reply.steps}
                  attachments={reply.attachments}
                  live
                />
              )}

              {error && (
                <li className={styles.error} role="alert">
                  <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className={styles.errorText}>{error.message}</span>
                  {RETRYABLE.includes(error.code) && (
                    <button className={styles.action} type="button" onClick={onRetry}>
                      <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
                      Try again
                    </button>
                  )}
                  {(error.code === 'invalid_key' || error.code === 'no_key') && canChangeKey && (
                    <button className={styles.action} type="button" onClick={onChangeKey}>
                      Change key
                    </button>
                  )}
                  <button className={styles.dismiss} type="button" onClick={onDismissError}>
                    Dismiss
                  </button>
                </li>
              )}
            </ol>
          )}
        </div>
      )}

      <div className={styles.footer}>{footer}</div>
    </section>
  )
}
