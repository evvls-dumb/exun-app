import { useDecrypt } from '@/hooks/useDecrypt'
import { nameStart } from '@/lib/path'
import styles from './PathField.module.css'

interface PathFieldProps {
  path: string | null
  label: string
  placeholder: string
}

function DecryptedPath({ path }: { path: string }) {
  const output = useDecrypt(path)
  const split = nameStart(path)

  return (
    <>
      <span className="sr-only">{path}</span>
      <span className={styles.parent} aria-hidden="true">
        {output.slice(0, split)}
      </span>
      <span className={styles.name} aria-hidden="true">
        {output.slice(split)}
      </span>
    </>
  )
}

export default function PathField({ path, label, placeholder }: PathFieldProps) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      {path ? (
        <DecryptedPath path={path} />
      ) : (
        <span className={styles.placeholder}>{placeholder}</span>
      )}
    </div>
  )
}
