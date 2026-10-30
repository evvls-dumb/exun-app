// A read-only view of "a set of files", whether they sit in a folder on disk or inside a .tar.gz pack.
// The intake reads both through the same interface, so a field-unit folder and the pack made from it are
// verified by identical code. Nothing here writes, and nothing follows a symbolic link out of the folder.

import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, posix, sep } from 'node:path'

export interface VFile {
  /** Path inside the set, forward slashes, no leading slash. */
  path: string
  size: number
  read: () => Promise<Buffer>
}

export interface Vfs {
  label: string
  files: VFile[]
  skipped: { name: string; reason: string }[]
}

export const MAX_FILES = 5000
export const MAX_FILE_BYTES = 512 * 1024 * 1024
const MAX_DEPTH = 12
const IGNORED = new Set(['node_modules', '.git', '.DS_Store', 'Thumbs.db', 'desktop.ini'])

export async function diskVfs(root: string, label: string): Promise<Vfs> {
  const files: VFile[] = []
  const skipped: Vfs['skipped'] = []

  async function walk(absolute: string, relative: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      skipped.push({ name: relative, reason: 'folders nested too deeply' })
      return
    }
    let entries
    try {
      entries = await readdir(absolute, { withFileTypes: true })
    } catch {
      skipped.push({ name: relative || label, reason: 'cannot be read' })
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue
      const abs = join(absolute, entry.name)
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (files.length >= MAX_FILES) {
        skipped.push({ name: rel, reason: `more than ${MAX_FILES} files; the rest were not read` })
        return
      }
      if (entry.isSymbolicLink()) {
        skipped.push({ name: rel, reason: 'symbolic link, not followed' })
      } else if (entry.isDirectory()) {
        await walk(abs, rel, depth + 1)
      } else if (entry.isFile()) {
        const info = await lstat(abs)
        if (info.size > MAX_FILE_BYTES) skipped.push({ name: rel, reason: 'larger than 512 MB' })
        else files.push({ path: rel.split(sep).join('/'), size: info.size, read: () => readFile(abs) })
      }
    }
  }

  await walk(root, '', 0)
  return { label, files, skipped }
}

export function memoryVfs(label: string, entries: { path: string; data: Buffer }[], skipped: Vfs['skipped'] = []): Vfs {
  return {
    label,
    skipped,
    files: entries.map((e) => ({ path: posix.normalize(e.path), size: e.data.length, read: async () => e.data }))
  }
}
