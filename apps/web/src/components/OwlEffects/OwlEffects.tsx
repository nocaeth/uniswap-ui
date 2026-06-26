import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import '~/components/OwlEffects/owl.css'

/** Window event that triggers the owl fountain (dispatched by the owl button). */
export const OWL_FOUNTAIN_EVENT = 'noca-owls'

const KONAMI = [
  'arrowup',
  'arrowup',
  'arrowdown',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'arrowleft',
  'arrowright',
  'b',
  'a',
]

type OwlSpec = {
  id: number
  kind: 'swoop' | 'fountain'
  style: CSSProperties
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Leaf component: owl spawns/removals re-render only this subtree, not the page that hosts it.
export function OwlEffects(): JSX.Element {
  const [owls, setOwls] = useState<OwlSpec[]>([])
  const owlSeq = useRef(0)
  const nightOwlTimer = useRef<number | undefined>(undefined)

  const spawnSwoopOwl = useCallback(() => {
    // without the animation there is no animationend to clean them up
    if (reducedMotion()) {
      return
    }
    setOwls((prev) => [
      ...prev,
      {
        id: ++owlSeq.current,
        kind: 'swoop',
        style: {
          top: `${5 + Math.random() * 75}vh`,
          fontSize: `${1.4 + Math.random() * 1.8}rem`,
          animationDuration: `${2.4 + Math.random() * 2.6}s`,
        },
      },
    ])
  }, [])

  const spawnFountain = useCallback(() => {
    if (reducedMotion()) {
      return
    }
    const burst = Array.from(
      { length: 120 },
      (): OwlSpec => ({
        id: ++owlSeq.current,
        kind: 'fountain',
        style: {
          fontSize: `${1.1 + Math.random() * 1.6}rem`,
          animationDuration: `${1.9 + Math.random() * 1.4}s`,
          animationDelay: `${Math.random() * 1.6}s`,
          '--dx': `${(Math.random() * 2 - 1) * 55}vw`,
          '--hy': `${-(18 + Math.random() * 34)}vh`,
          '--fy': `${60 + Math.random() * 15}vh`,
          '--rot': `${(Math.random() * 2 - 1) * 160}deg`,
        } as CSSProperties,
      }),
    )
    setOwls((prev) => [...prev, ...burst])
  }, [])

  // Konami code → a single owl swoops across the screen
  useEffect(() => {
    let buffer: string[] = []
    const onKey = (e: KeyboardEvent): void => {
      buffer = [...buffer, e.key.toLowerCase()].slice(-KONAMI.length)
      if (buffer.length === KONAMI.length && KONAMI.every((k, i) => buffer[i] === k)) {
        buffer = []
        spawnSwoopOwl()
        document.body.classList.add('night-owl')
        window.clearTimeout(nightOwlTimer.current)
        nightOwlTimer.current = window.setTimeout(() => document.body.classList.remove('night-owl'), 8000)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spawnSwoopOwl])

  // Owl button → owl fountain burst (works on touch, unlike the konami code)
  useEffect(() => {
    const onFountain = (): void => spawnFountain()
    window.addEventListener(OWL_FOUNTAIN_EVENT, onFountain)
    return () => window.removeEventListener(OWL_FOUNTAIN_EVENT, onFountain)
  }, [spawnFountain])

  return (
    <>
      {owls.map(({ id, kind, style }) => (
        // oxlint-disable-next-line react/forbid-elements -- raw div needed for the global keyframe class, CSS custom-property style, and onAnimationEnd cleanup
        <div
          key={id}
          className={kind === 'fountain' ? 'owl-fountain' : 'owl-flight'}
          style={style}
          onAnimationEnd={() => setOwls((prev) => prev.filter((x) => x.id !== id))}
        >
          🦉
        </div>
      ))}
    </>
  )
}
