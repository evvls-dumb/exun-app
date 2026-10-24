import { useCallback, useRef, useState } from 'react'

const EXIT_MS = 300

export function useScreenFlow<Screen extends string>(initial: Screen) {
  const [screen, setScreen] = useState(initial)
  const [leaving, setLeaving] = useState(false)
  const transitioning = useRef(false)

  const go = useCallback((next: Screen) => {
    if (transitioning.current) return
    transitioning.current = true
    setLeaving(true)

    setTimeout(() => {
      setScreen(next)
      setLeaving(false)
      transitioning.current = false
    }, EXIT_MS)
  }, [])

  const show = useCallback((next: Screen) => setScreen(next), [])

  return { screen, leaving, go, show }
}
