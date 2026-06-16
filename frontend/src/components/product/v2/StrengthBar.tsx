type StrengthBarProps = {
  name: string
  color: string
  /** 0–100, or null when the community strength is unknown. */
  pct: number | null
}

/** A labelled horizontal meter — used for accord strength. */
export function StrengthBar({ name, color, pct }: StrengthBarProps) {
  return (
    <div
      className="grid items-center gap-4 py-2"
      style={{ gridTemplateColumns: '120px 1fr 36px' }}
    >
      <span className="inline-flex items-center gap-2 text-sm text-text">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        {name}
      </span>
      <span className="relative h-[3px] rounded-sm bg-border">
        <span
          className="absolute inset-y-0 left-0 rounded-sm bg-accent"
          style={{ width: `${pct ?? 0}%` }}
        />
      </span>
      <span className="text-right text-xs tabular-nums text-text-secondary">{pct ?? '—'}</span>
    </div>
  )
}
