import { useState } from 'react'
import { Check, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from 'lucide-react'
import { formatListTime } from '@/lib/format'
import type { AiStatus, ConversationSummary } from '@shared/ai'
import styles from './ConversationList.module.css'

const LEAVE_MS = 220

interface ConversationListProps {
  conversations: readonly ConversationSummary[]
  activeId: string | null
  status: AiStatus | null
  collapsed: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onNew: () => void
  onRemove: (id: string) => void
  onClearKey: () => void
}

export default function ConversationList({
  conversations,
  activeId,
  status,
  collapsed,
  onToggle,
  onSelect,
  onNew,
  onRemove,
  onClearKey
}: ConversationListProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)

  function confirmDelete(id: string) {
    setConfirming(null)
    setLeaving(id)
    window.setTimeout(() => {
      onRemove(id)
      setLeaving(null)
    }, LEAVE_MS)
  }

  return (
    <section
      className={styles.panel}
      aria-label="Conversations"
      data-collapsed={collapsed || undefined}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Conversations</h2>
        <div className={styles.actions}>
          <button
            className={styles.new}
            type="button"
            aria-label={collapsed ? 'Show conversations' : 'Hide conversations'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Show conversations' : 'Hide conversations'}
            onClick={onToggle}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          <button
            className={styles.new}
            type="button"
            aria-label="New chat"
            title="New chat"
            onClick={onNew}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </header>

      {collapsed ? null : conversations.length === 0 ? (
        <p className={styles.empty}>Your chats will appear here.</p>
      ) : (
        <ul className={styles.list}>
          {conversations.map((conversation) => {
            const armed = confirming === conversation.id
            return (
              <li
                key={conversation.id}
                className={styles.row}
                data-active={conversation.id === activeId || undefined}
                data-armed={armed || undefined}
                data-leaving={leaving === conversation.id || undefined}
                onMouseLeave={() => {
                  if (armed) setConfirming(null)
                }}
              >
                <button
                  className={styles.item}
                  type="button"
                  aria-current={conversation.id === activeId ? 'true' : undefined}
                  onClick={() => {
                    setConfirming(null)
                    onSelect(conversation.id)
                  }}
                >
                  <span className={styles.text}>
                    <span className={styles.name}>{conversation.title}</span>
                    <span className={styles.preview}>{conversation.preview || 'No messages yet'}</span>
                  </span>
                  <span className={styles.time}>{formatListTime(conversation.updatedAt)}</span>
                </button>

                <button
                  className={styles.delete}
                  type="button"
                  aria-label={armed ? `Confirm delete ${conversation.title}` : `Delete ${conversation.title}`}
                  title={armed ? 'Click again to delete' : 'Delete chat'}
                  onClick={() => (armed ? confirmDelete(conversation.id) : setConfirming(conversation.id))}
                  onBlur={() => {
                    if (armed) setConfirming(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setConfirming(null)
                  }}
                >
                  {armed ? (
                    <Check size={14} strokeWidth={2.25} aria-hidden="true" />
                  ) : (
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!collapsed && status?.source === 'stored' && (
        <footer className={styles.footer}>
          <span className={styles.key}>Key saved on this device</span>
          <button className={styles.remove} type="button" onClick={onClearKey}>
            Remove key
          </button>
        </footer>
      )}
    </section>
  )
}
