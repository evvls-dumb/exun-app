import { useEffect, useState } from 'react'
import type { MachineReport } from '@shared/machine'

export type MachineState =
  | { status: 'loading' }
  | { status: 'ready'; report: MachineReport }
  | { status: 'error' }

export function useMachine(sessionId: string): MachineState {
  const [state, setState] = useState<MachineState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })

    window.janus.machine
      .report(sessionId)
      .then((report) => {
        if (current) setState({ status: 'ready', report })
      })
      .catch(() => {
        if (current) setState({ status: 'error' })
      })

    return () => {
      current = false
    }
  }, [sessionId])

  return state
}
