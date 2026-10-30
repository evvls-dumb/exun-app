import { useMemo, useState } from 'react'
import type { Analysis } from '@shared/meter'
import { useChat } from '@/hooks/useChat'
import { formatNumber, formatShortDate, todayIso } from '@/lib/format'
import type { SendOptions } from '@/hooks/useChat'
import styles from './AiPage.module.css'
import ChatPanel from './ChatPanel'
import Composer from './Composer'
import type { MenuOption } from './ComposerMenu'
import ConversationList from './ConversationList'

const DEFAULT_TITLE = 'New chat'
const COLLAPSED_KEY = 'janus.conversationsCollapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Persisting is a convenience; the toggle still works without it.
  }
}

function dayStatus(day: Analysis['days'][number]): string {
  if (day.spike) return 'Spike'
  if (day.mismatch) return 'Mismatch'
  if (day.future) return 'Future-dated'
  return 'Normal'
}

function buildSuggestions(analysis: Analysis): string[] {
  const spike = analysis.days.find((day) => day.spike)
  return [
    'Investigate this log and write a PDF report',
    ...(spike ? [`Chart the ${formatShortDate(spike.date)} spike and estimate its cost`] : []),
    'Audit the log’s integrity',
    'Export the flagged days to CSV'
  ]
}

interface AiPageProps {
  analysis: Analysis
}

export default function AiPage({ analysis }: AiPageProps) {
  const chat = useChat()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  function toggleCollapsed() {
    setCollapsed((current) => {
      writeCollapsed(!current)
      return !current
    })
  }

  const caseData = useMemo(
    () => ({
      entries: analysis.days.map(({ date, reading, usage }) => ({ date, reading, usage })),
      today: todayIso()
    }),
    [analysis]
  )
  const suggestions = useMemo(() => buildSuggestions(analysis), [analysis])
  const mentions = useMemo<MenuOption<string>[]>(
    () =>
      [...analysis.days]
        .sort((a, b) => Number(b.spike || b.mismatch) - Number(a.spike || a.mismatch))
        .map((day) => ({
          value: day.date,
          label: formatShortDate(day.date),
          hint: `${formatNumber(day.usage)} kWh · ${dayStatus(day)}`
        })),
    [analysis]
  )

  const { status } = chat
  const needsKey = status !== null && !status.configured
  const options: SendOptions = { mode: 'agent', model: 'auto', caseData }
  const title =
    chat.conversations.find((conversation) => conversation.id === chat.activeId)?.title ??
    DEFAULT_TITLE

  return (
    <div className={styles.page} data-collapsed={collapsed || undefined}>
      <ConversationList
        conversations={chat.conversations}
        activeId={chat.activeId}
        status={status}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onSelect={chat.select}
        onNew={chat.startNew}
        onRemove={chat.remove}
        onClearKey={chat.clearKey}
      />

      <ChatPanel
        title={title}
        messages={chat.messages}
        reply={chat.reply}
        error={chat.error}
        needsKey={needsKey}
        canStoreKey={status?.canStoreKey ?? true}
        canChangeKey={status?.source === 'stored'}
        suggestions={suggestions}
        onSuggest={(text) => void chat.send(text, options)}
        onRetry={() => chat.retry(options)}
        onDismissError={chat.dismissError}
        onChangeKey={chat.clearKey}
        onSaveKey={chat.saveKey}
        footer={
          <Composer
            mentions={mentions}
            running={chat.running}
            disabled={status === null || needsKey}
            placeholder={needsKey ? 'Add an API key to start' : 'Ask about this case…'}
            onSend={(text) => void chat.send(text, options)}
            onStop={chat.cancel}
          />
        }
      />
    </div>
  )
}
