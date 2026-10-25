import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

interface MarkdownProps {
  text: string
}

export default function Markdown({ text }: MarkdownProps) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children }) => <span className={styles.link}>{children}</span>,
          img: () => null,
          table: ({ children }) => (
            <div className={styles.table}>
              <table>{children}</table>
            </div>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
