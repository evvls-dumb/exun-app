import { useEffect, useState } from 'react'

const GLYPHS = '!<>-_\\/[]{}=+*^?#%&$01'
const FIXED_CHARS = /[\s\\/]/
const TICK_MS = 28
const START_DELAY_TICKS = 5
const MAX_REVEAL_TICKS = 24

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

function scramble(text: string, revealed: number): string {
  return Array.from(text, (char, index) =>
    index < revealed || FIXED_CHARS.test(char) ? char : randomGlyph()
  ).join('')
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useDecrypt(text: string): string {
  const [output, setOutput] = useState(() => scramble(text, 0))

  useEffect(() => {
    if (prefersReducedMotion()) {
      setOutput(text)
      return
    }

    const charsPerTick = Math.max(1, Math.ceil(text.length / MAX_REVEAL_TICKS))
    let tick = 0
    setOutput(scramble(text, 0))

    const timer = setInterval(() => {
      tick += 1
      const revealed = Math.max(0, (tick - START_DELAY_TICKS) * charsPerTick)
      setOutput(scramble(text, revealed))
      if (revealed >= text.length) clearInterval(timer)
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [text])

  return output
}
