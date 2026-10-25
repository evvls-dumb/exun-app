import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiStatus } from '../../shared/ai'
import { AiError } from './errors'

const KEY_FILE = 'groq-key.bin'
export const KEY_ENV_VAR = 'GROQ_API_KEY'
const MIN_KEY_LENGTH = 20

export interface SecretCipher {
  isAvailable(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export class CredentialStore {
  private stored: string | null = null
  private readonly loading: Promise<void>

  constructor(
    private readonly directory: string,
    private readonly cipher: SecretCipher,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.loading = this.load()
  }

  private get file(): string {
    return join(this.directory, KEY_FILE)
  }

  private async load(): Promise<void> {
    try {
      if (!this.cipher.isAvailable()) return
      this.stored = this.cipher.decrypt(await readFile(this.file)) || null
    } catch {
      this.stored = null
    }
  }

  private envKey(): string | null {
    return this.env[KEY_ENV_VAR]?.trim() || null
  }

  async getKey(): Promise<string | null> {
    await this.loading
    return this.stored ?? this.envKey()
  }

  async status(): Promise<AiStatus> {
    await this.loading
    const source = this.stored ? 'stored' : this.envKey() ? 'env' : null
    return { configured: source !== null, source, canStoreKey: this.cipher.isAvailable() }
  }

  async setKey(raw: string): Promise<void> {
    const key = raw.trim()
    if (key.length < MIN_KEY_LENGTH || /\s/.test(key)) {
      throw new AiError('invalid_key', 'That doesn’t look like an API key.')
    }
    if (!this.cipher.isAvailable()) {
      throw new AiError(
        'failed',
        'Secure storage isn’t available on this system, so the key can’t be saved. Set the GROQ_API_KEY environment variable instead.'
      )
    }

    await this.loading
    await mkdir(this.directory, { recursive: true })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, this.cipher.encrypt(key), { mode: 0o600 })
    await rename(temporary, this.file)
    this.stored = key
  }

  async clearKey(): Promise<void> {
    await this.loading
    this.stored = null
    await rm(this.file, { force: true })
  }
}
