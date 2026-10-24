import { useDecrypt } from '@/hooks/useDecrypt'

interface DecryptTextProps {
  text: string
  className?: string
}

export default function DecryptText({ text, className }: DecryptTextProps) {
  const output = useDecrypt(text)

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{output}</span>
    </span>
  )
}
