import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessage, Conversation, ConversationSummary } from '../../shared/ai'

const STORE_FILE = 'conversations.json'
const DEFAULT_TITLE = 'New chat'
const TITLE_LENGTH = 48
const PREVIEW_LENGTH = 120

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ')
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line || DEFAULT_TITLE
}

function summarise(conversation: Conversation): ConversationSummary {
  const last = conversation.messages.at(-1)
  return {
    id: conversation.id,
    title: conversation.title,
    preview: last ? last.content.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH) : '',
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  }
}

function isMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return (
    typeof message['id'] === 'string' &&
    (message['role'] === 'user' || message['role'] === 'assistant') &&
    typeof message['content'] === 'string' &&
    typeof message['createdAt'] === 'string' &&
    (message['steps'] === undefined || Array.isArray(message['steps'])) &&
    (message['attachments'] === undefined || Array.isArray(message['attachments']))
  )
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== 'object' || value === null) return false
  const conversation = value as Record<string, unknown>
  return (
    typeof conversation['id'] === 'string' &&
    typeof conversation['title'] === 'string' &&
    typeof conversation['createdAt'] === 'string' &&
    typeof conversation['updatedAt'] === 'string' &&
    Array.isArray(conversation['messages']) &&
    conversation['messages'].every(isMessage)
  )
}

export function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: randomUUID(), role, content, createdAt: new Date().toISOString() }
}

export class ConversationStore {
  private conversations: Conversation[] | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {}

  private get file(): string {
    return join(this.directory, STORE_FILE)
  }

  private async all(): Promise<Conversation[]> {
    if (this.conversations) return this.conversations
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      this.conversations = Array.isArray(parsed) ? parsed.filter(isConversation) : []
    } catch {
      this.conversations = []
    }
    return this.conversations
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.conversations ?? [], null, 2)
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true })
        const temporary = `${this.file}.tmp`
        await writeFile(temporary, snapshot)
        await rename(temporary, this.file)
      })
    return this.writing
  }

  async list(): Promise<ConversationSummary[]> {
    const conversations = await this.all()
    return conversations
      .map(summarise)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(id: string): Promise<Conversation | null> {
    const found = (await this.all()).find((conversation) => conversation.id === id)
    return found ? structuredClone(found) : null
  }

  async create(): Promise<Conversation> {
    const conversations = await this.all()
    const now = new Date().toISOString()
    const conversation: Conversation = {
      id: randomUUID(),
      title: DEFAULT_TITLE,
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    conversations.push(conversation)
    await this.persist()
    return structuredClone(conversation)
  }

  async append(id: string, message: ChatMessage): Promise<Conversation> {
    const conversation = (await this.all()).find((candidate) => candidate.id === id)
    if (!conversation) throw new Error('Conversation not found')

    conversation.messages.push(message)
    conversation.updatedAt = message.createdAt
    if (conversation.title === DEFAULT_TITLE && message.role === 'user') {
      conversation.title = titleFrom(message.content)
    }
    await this.persist()
    return structuredClone(conversation)
  }

  async remove(id: string): Promise<void> {
    const conversations = await this.all()
    const index = conversations.findIndex((conversation) => conversation.id === id)
    if (index < 0) return
    conversations.splice(index, 1)
    await this.persist()
  }

  summary(conversation: Conversation): ConversationSummary {
    return summarise(conversation)
  }
}
