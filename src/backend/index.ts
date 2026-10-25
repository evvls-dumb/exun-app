import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { CredentialStore, type SecretCipher } from './ai/credentials'
import { GroqProvider } from './ai/groq'
import { ChatService } from './chat/service'
import { ConversationStore } from './chat/store'
import { loadLocalEnv } from './env'
import { NoteStore } from './agent/notes'
import { registerAiIpc } from './ipc'
import { ReportFiles } from './reports/files'
import { renderPdf } from './reports/pdf'

const cipher: SecretCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data)
}

export function registerBackend(): void {
  if (!app.isPackaged) loadLocalEnv(app.getAppPath())

  const directory = app.getPath('userData')
  const credentials = new CredentialStore(directory, cipher)
  const conversations = new ConversationStore(directory)
  const provider = new GroqProvider(() => credentials.getKey())
  const files = new ReportFiles(join(app.getPath('documents'), 'Janus Reports'), renderPdf)
  const service = new ChatService(provider, conversations, files, new NoteStore(directory))

  registerAiIpc({ service, conversations, credentials, files })
}
