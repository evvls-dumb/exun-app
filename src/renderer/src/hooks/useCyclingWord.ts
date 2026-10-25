import { useEffect, useState } from 'react'

export function useCyclingWord(words: readonly string[], intervalMs: number): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => (current + 1) % words.length), intervalMs)
    return () => clearInterval(timer)
  }, [words.length, intervalMs])

  return words[index]
}
