import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import styles from './FloatingTip.module.css'

const GAP_PX = 14
const EDGE_PX = 8

interface TipState {
  content: ReactNode
  x: number
  y: number
}

interface PointerLike {
  clientX: number
  clientY: number
}

function Floating({ content, x, y }: TipState) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { offsetWidth: width, offsetHeight: height } = element
    const above = y - height - GAP_PX
    const top = above < EDGE_PX ? y + GAP_PX + 4 : above
    const left = Math.min(Math.max(x - width / 2, EDGE_PX), window.innerWidth - width - EDGE_PX)
    setPosition({ left, top })
  }, [x, y, content])

  return (
    <div ref={ref} className={styles.floating} style={{ left: position.left, top: position.top }}>
      {content}
    </div>
  )
}

export function useFloatingTip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const pendingHide = useRef(0)

  const show = useCallback((content: ReactNode, pointer: PointerLike) => {
    cancelAnimationFrame(pendingHide.current)
    setTip({ content, x: pointer.clientX, y: pointer.clientY })
  }, [])

  const hide = useCallback(() => {
    cancelAnimationFrame(pendingHide.current)
    pendingHide.current = requestAnimationFrame(() => setTip(null))
  }, [])

  useEffect(() => () => cancelAnimationFrame(pendingHide.current), [])

  const element = tip ? createPortal(<Floating {...tip} />, document.body) : null
  return { element, show, hide }
}
