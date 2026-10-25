import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, AtSign, Square } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { MAX_MESSAGE_CHARS } from '@shared/ai'
import ComposerMenu, { type MenuOption } from './ComposerMenu'
import styles from './Composer.module.css'

const MAX_HEIGHT_PX = 176
const COUNTER_FROM = MAX_MESSAGE_CHARS * 0.8

interface ComposerProps {
  mentions: readonly MenuOption<string>[]
  running: boolean
  disabled: boolean
  placeholder: string
  onSend: (text: string) => void
  onStop: () => void
}

export default function Composer({
  mentions,
  running,
  disabled,
  placeholder,
  onSend,
  onStop
}: ComposerProps) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const tooLong = text.length > MAX_MESSAGE_CHARS
  const canSend = text.trim().length > 0 && !tooLong && !running && !disabled

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [text])

  useEffect(() => {
    if (!disabled && !running) inputRef.current?.focus()
  }, [disabled, running])

  function submit() {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  function mention(label: string) {
    const input = inputRef.current
    const start = input?.selectionStart ?? text.length
    const end = input?.selectionEnd ?? text.length
    const before = text.slice(0, start)
    const spacer = before && !/\s$/.test(before) ? ' ' : ''
    const inserted = `${spacer}@${label} `
    setText(before + inserted + text.slice(end))
    requestAnimationFrame(() => {
      input?.focus()
      const caret = before.length + inserted.length
      input?.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className={styles.frame}>
      <div
        className={styles.box}
        data-focused={focused || undefined}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="Message Janus"
          aria-invalid={tooLong || undefined}
          disabled={disabled}
          spellCheck
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className={styles.bar}>
          <ComposerMenu
            ariaLabel="Mention a day"
            options={mentions}
            onSelect={mention}
            disabled={disabled || mentions.length === 0}
            emptyText="No days to mention yet."
          >
            <AtSign size={14} strokeWidth={1.75} aria-hidden="true" />
          </ComposerMenu>

          <span className={styles.status}>
            {text.length >= COUNTER_FROM && (
              <span className={styles.counter} data-over={tooLong || undefined}>
                {formatNumber(text.length, 0)} / {formatNumber(MAX_MESSAGE_CHARS, 0)}
              </span>
            )}
          </span>

          <button
            className={styles.send}
            type="button"
            aria-label={running ? 'Stop' : 'Send message'}
            data-ready={canSend || undefined}
            data-running={running || undefined}
            disabled={!running && !canSend}
            onClick={running ? onStop : submit}
          >
            <ArrowUp className={styles.arrow} size={16} strokeWidth={2} aria-hidden="true" />
            <Square className={styles.stop} size={11} fill="currentColor" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
