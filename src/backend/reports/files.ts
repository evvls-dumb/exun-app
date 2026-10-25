import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import type { FileSink, SavedFile } from '../agent/tools'

const MAX_SLUG = 60

function slugOf(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '')
  return slug || 'janus-report'
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export class ReportFiles implements FileSink {
  constructor(
    readonly directory: string,
    private readonly renderPdf: (html: string) => Promise<Buffer>
  ) {}

  private async write(title: string, extension: string, data: string | Buffer): Promise<SavedFile> {
    await mkdir(this.directory, { recursive: true })
    const name = `${slugOf(title)}-${stamp(new Date())}.${extension}`
    const path = join(this.directory, name)
    await writeFile(path, data, { flag: 'wx' })
    return { name, path, bytes: (await stat(path)).size }
  }

  async savePdf(title: string, html: string): Promise<SavedFile> {
    return this.write(title, 'pdf', await this.renderPdf(html))
  }

  saveText(title: string, extension: string, text: string): Promise<SavedFile> {
    return this.write(title, extension, text)
  }

  contains(path: string): boolean {
    const inside = relative(resolve(this.directory), resolve(path))
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
  }
}
