import { Star } from 'lucide-react'

type StatProps = {
  value: string | null
  unit?: string
  label: string
  icon?: 'star'
  wide?: boolean
}

/** A single quick-stat: a display-font value (or placeholder dash) + meta label. */
export function Stat({ value, unit, label, icon, wide }: StatProps) {
  return (
    <div className="mb-2">
      <div className="flex items-baseline gap-1">
        {icon === 'star' ? <Star className="h-[15px] w-[15px] self-center text-accent" /> : null}
        <span
          className={`whitespace-nowrap font-display text-text ${wide ? 'text-lg' : 'text-2xl'}`}
        >
          {value ?? <span className="text-text-secondary/60">—</span>}
        </span>
        {unit && value ? <span className="text-xs text-text-secondary">{unit}</span> : null}
      </div>
      <span className="whitespace-nowrap text-xs uppercase tracking-[0.07em] text-text-secondary">
        {label}
      </span>
    </div>
  )
}
