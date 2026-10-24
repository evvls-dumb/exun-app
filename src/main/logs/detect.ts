import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APP_FOLDER = 'Janus'
const LOGS_FILE = 'logs.janus'

function logsFilePath(): string {
  const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
  return join(localAppData, APP_FOLDER, LOGS_FILE)
}

export async function detectLogsFile(): Promise<string | null> {
  const path = logsFilePath()
  try {
    return (await stat(path)).isFile() ? path : null
  } catch {
    return null
  }
}
