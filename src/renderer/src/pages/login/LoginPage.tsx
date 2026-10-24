import { useState, type FormEvent } from 'react'
import Button from '@/components/Button'
import DecryptText from '@/components/DecryptText'
import styles from './LoginPage.module.css'

interface LoginPageProps {
  onLogin: (key: string) => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [key, setKey] = useState('')
  const canSubmit = key.trim().length > 0

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSubmit) onLogin(key)
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>
        <DecryptText text="Welcome Back, Agent" />
      </h1>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="Enter your key"
          aria-label="Access key"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <Button type="submit" disabled={!canSubmit}>
          Login
        </Button>
      </form>
    </main>
  )
}
