import styles from './CodeLine.module.css'

const KEYWORDS = new Set([
  'break', 'case', 'char', 'class', 'const', 'default', 'else', 'for', 'if', 'int',
  'private', 'protected', 'public', 'return', 'struct', 'switch', 'void', 'while'
])

const TOKEN = /(\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(#\w+.*$)|(\b\d+\b)|(\b[A-Za-z_]\w*\b)/g

interface CodeLineProps {
  text: string
  types: ReadonlySet<string>
}

export default function CodeLine({ text, types }: CodeLineProps) {
  const parts: { text: string; tone?: string }[] = []
  let cursor = 0
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ text: text.slice(cursor, index) })
    const [token, comment, literal, directive, number, word] = match
    const tone = comment
      ? 'comment'
      : literal
        ? 'literal'
        : directive
          ? 'directive'
          : number
            ? 'number'
            : word && KEYWORDS.has(word)
              ? 'keyword'
              : word && (types.has(word) || word === 'std')
                ? 'type'
                : undefined
    parts.push({ text: token, tone })
    cursor = index + token.length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })

  return (
    <code className={styles.code}>
      {parts.map((part, index) =>
        part.tone ? (
          <span key={index} data-tone={part.tone}>
            {part.text}
          </span>
        ) : (
          part.text
        )
      )}
    </code>
  )
}
