import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCAL_ENV_FILE = '.env.local'

export function loadLocalEnv(root: string): void {
  let text: string
  try {
    text = readFileSync(join(root, LOCAL_ENV_FILE), 'utf8')
  } catch {
    return
  }

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match || line.trimStart().startsWith('#')) continue
    const [, name, raw] = match
    const value = raw.replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[name] === undefined) process.env[name] = value
  }
}
