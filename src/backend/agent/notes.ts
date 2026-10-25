import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CaseNote {
  id: string
  text: string
  createdAt: string
}

const NOTES_FILE = 'case-notes.json'
const MAX_NOTES = 200

export class NoteStore {
  private notes: CaseNote[] | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {}

  private get file(): string {
    return join(this.directory, NOTES_FILE)
  }

  async list(): Promise<CaseNote[]> {
    if (!this.notes) {
      try {
        const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
        this.notes = Array.isArray(parsed)
          ? parsed.filter(
              (note): note is CaseNote =>
                typeof note?.id === 'string' && typeof note?.text === 'string' && typeof note?.createdAt === 'string'
            )
          : []
      } catch {
        this.notes = []
      }
    }
    return [...this.notes]
  }

  async add(text: string): Promise<CaseNote> {
    const notes = await this.list()
    const note: CaseNote = { id: randomUUID(), text, createdAt: new Date().toISOString() }
    this.notes = [...notes, note].slice(-MAX_NOTES)
    const snapshot = JSON.stringify(this.notes, null, 2)
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true })
        await writeFile(`${this.file}.tmp`, snapshot)
        await rename(`${this.file}.tmp`, this.file)
      })
    await this.writing
    return note
  }
}
