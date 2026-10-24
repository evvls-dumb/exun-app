import { useEffect, useState } from 'react'

export type LogsFile =
  | { status: 'detecting' }
  | { status: 'found'; path: string }
  | { status: 'missing' }

export function useLogsFile(): LogsFile {
  const [logsFile, setLogsFile] = useState<LogsFile>({ status: 'detecting' })

  useEffect(() => {
    let current = true

    async function detect() {
      const path = await window.janus.detectLogsFile().catch(() => null)
      if (current) setLogsFile(path ? { status: 'found', path } : { status: 'missing' })
    }

    detect()
    window.addEventListener('focus', detect)

    return () => {
      current = false
      window.removeEventListener('focus', detect)
    }
  }, [])

  return logsFile
}
