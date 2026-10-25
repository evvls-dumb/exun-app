import { useCyclingWord } from '@/hooks/useCyclingWord'
import LumaSpin from './LumaSpin'
import styles from './Analysing.module.css'

const WORDS = [
  'Analysing',
  'Simulating',
  'Brainstorming',
  'Correlating',
  'Cross-referencing',
  'Triangulating',
  'Reconstructing',
  'Deciphering'
] as const

const WORD_MS = 1500

export default function Analysing() {
  const word = useCyclingWord(WORDS, WORD_MS)

  return (
    <div className={styles.root} role="status">
      <span className="sr-only">Analysing logs file</span>

      <LumaSpin size={72} />

      <p className={styles.word} aria-hidden="true">
        <span key={word} className={styles.shimmer}>
          {word}…
        </span>
      </p>
    </div>
  )
}
