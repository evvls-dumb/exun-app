// A small reader for the .tar.gz packs `janus pack` writes. It reads regular files only, and it refuses
// anything that could escape the pack: absolute paths, "..", links, devices. It also bounds how much it
// will expand, so a decompression bomb cannot exhaust memory. No code in the archive is ever run.

import { gunzipSync } from 'node:zlib'

export interface TarEntry {
  path: string
  data: Buffer
}

export interface TarResult {
  entries: TarEntry[]
  skipped: { name: string; reason: string }[]
}

export const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
const MAX_ENTRIES = 20_000

export function isGzip(data: Uint8Array): boolean {
  return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b
}

export function gunzip(data: Buffer): Buffer {
  return gunzipSync(data, { maxOutputLength: MAX_EXPANDED_BYTES })
}

function cstring(buf: Buffer, start: number, end: number): string {
  const slice = buf.subarray(start, end)
  const nul = slice.indexOf(0)
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8')
}

function octal(buf: Buffer, start: number, end: number): number {
  const text = cstring(buf, start, end).trim()
  return text ? parseInt(text, 8) : 0
}

function safe(path: string): string | null {
  const normal = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normal || normal.startsWith('/') || /^[A-Za-z]:/.test(normal) || normal.includes('\0')) return null
  if (normal.split('/').some((part) => part === '..')) return null
  return normal.replace(/\/+$/, '')
}

/** Does this decompressed buffer look like a tar archive? */
export function looksLikeTar(buf: Buffer): boolean {
  return buf.length >= 512 && buf.subarray(257, 262).toString('latin1') === 'ustar'
}

export function readTar(buf: Buffer): TarResult {
  const entries: TarEntry[] = []
  const skipped: TarResult['skipped'] = []
  let offset = 0
  let longName: string | null = null
  let paxPath: string | null = null

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    let name = cstring(header, 0, 100)
    const size = octal(header, 124, 136)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = header.subarray(257, 262).toString('latin1') === 'ustar' ? cstring(header, 345, 500) : ''
    if (prefix) name = `${prefix}/${name}`
    offset += 512
    const dataEnd = offset + size
    if (size < 0 || dataEnd > buf.length) {
      skipped.push({ name, reason: 'the archive is truncated' })
      break
    }
    const data = buf.subarray(offset, dataEnd)
    offset += Math.ceil(size / 512) * 512

    if (type === 'L') {
      longName = cstring(data, 0, data.length)
      continue
    }
    if (type === 'x' || type === 'g') {
      if (type === 'x') {
        for (const record of data.toString('utf8').split('\n')) {
          const m = /^\d+ path=(.*)$/.exec(record)
          if (m) paxPath = m[1]
        }
      }
      continue
    }
    const finalName = longName ?? paxPath ?? name
    longName = null
    paxPath = null

    if (type === '5') continue // directory
    if (type !== '0' && type !== '\0') {
      skipped.push({ name: finalName, reason: type === '1' || type === '2' ? 'link, not followed' : 'special file, skipped' })
      continue
    }
    const clean = safe(finalName)
    if (!clean) {
      skipped.push({ name: finalName, reason: 'unsafe path in archive, skipped' })
      continue
    }
    if (entries.length >= MAX_ENTRIES) {
      skipped.push({ name: clean, reason: 'too many files in the archive' })
      break
    }
    entries.push({ path: clean, data: Buffer.from(data) })
  }
  return { entries, skipped }
}
