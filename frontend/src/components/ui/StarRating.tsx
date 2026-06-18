import { Star } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../lib/utils'

type StarRatingProps = {
  /** Current value, 0–5 (0 = none). */
  value: number
  /** When provided, the stars are an interactive input. Omit for read-only. */
  onChange?: (value: number) => void
  size?: number
  className?: string
}

/** A 1–5 star control. Interactive when `onChange` is given, else read-only. */
export function StarRating({ value, onChange, size = 24, className }: StarRatingProps) {
  const [hover, setHover] = useState(0)
  const interactive = Boolean(onChange)
  const active = hover || value

  const stars = [1, 2, 3, 4, 5].map((n) => {
    const filled = n <= active
    const star = (
      <Star
        size={size}
        strokeWidth={1.5}
        className={filled ? 'fill-accent text-accent' : 'text-border'}
      />
    )
    if (!interactive) return <span key={n}>{star}</span>
    return (
      <button
        key={n}
        type="button"
        aria-label={`${n} star${n > 1 ? 's' : ''}`}
        aria-pressed={value === n}
        onClick={() => onChange?.(n)}
        onMouseEnter={() => setHover(n)}
        onMouseLeave={() => setHover(0)}
        className="cursor-pointer p-0.5 transition-transform duration-150 hover:scale-110"
      >
        {star}
      </button>
    )
  })

  return (
    <div className={cn('flex items-center', interactive ? '-ml-0.5 gap-0.5' : 'gap-0.5', className)}>
      {stars}
    </div>
  )
}
