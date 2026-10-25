import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Check, type LucideIcon } from 'lucide-react'
import styles from './ComposerMenu.module.css'

const GAP_PX = 8
const EDGE_PX = 8

export interface MenuOption<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: LucideIcon
}

interface ComposerMenuProps<T extends string> {
  ariaLabel: string
  options: readonly MenuOption<T>[]
  onSelect: (value: T) => void
  value?: T
  disabled?: boolean
  emptyText?: string
  children: ReactNode
}

export default function ComposerMenu<T extends string>({
  ariaLabel,
  options,
  onSelect,
  value,
  disabled,
  emptyText,
  children
}: ComposerMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [position, setPosition] = useState({ left: 0, bottom: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  function openMenu() {
    const selected = options.findIndex((option) => option.value === value)
    setHighlight(Math.max(0, selected))
    setOpen(true)
  }

  function choose(option: MenuOption<T>) {
    setOpen(false)
    buttonRef.current?.focus()
    onSelect(option.value)
  }

  useLayoutEffect(() => {
    const button = buttonRef.current
    const list = listRef.current
    if (!open || !button || !list) return
    const rect = button.getBoundingClientRect()
    const left = Math.min(rect.left, window.innerWidth - list.offsetWidth - EDGE_PX)
    setPosition({ left: Math.max(EDGE_PX, left), bottom: window.innerHeight - rect.top + GAP_PX })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()

    function handlePointer(event: PointerEvent) {
      const target = event.target as Node
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointer)
    return () => document.removeEventListener('pointerdown', handlePointer)
  }, [open])

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((current) => (current + step + options.length) % Math.max(1, options.length))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (options[highlight]) choose(options[highlight])
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={styles.chip}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {children}
      </button>

      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            className={styles.list}
            role="listbox"
            aria-label={ariaLabel}
            aria-activedescendant={options[highlight] ? `${listId}-${highlight}` : undefined}
            tabIndex={-1}
            style={{ left: position.left, bottom: position.bottom }}
            onKeyDown={handleListKeyDown}
          >
            {options.length === 0 && <li className={styles.empty}>{emptyText ?? 'Nothing to choose.'}</li>}
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                className={styles.option}
                role="option"
                aria-selected={option.value === value}
                data-active={index === highlight || undefined}
                onPointerEnter={() => setHighlight(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option.icon && (
                  <option.icon className={styles.icon} size={15} strokeWidth={1.75} aria-hidden="true" />
                )}
                <span className={styles.text}>
                  <span className={styles.label}>{option.label}</span>
                  {option.hint && <span className={styles.hint}>{option.hint}</span>}
                </span>
                {option.value === value && <Check size={14} strokeWidth={2.25} aria-hidden="true" />}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  )
}
