import type { VoteDimensionView } from '../../../lib/productViewV2'
import { cn } from '../../../lib/utils'

// Leading option takes the accent; the rest step down through warm neutrals.
const TINTS = ['var(--color-accent)', 'var(--color-taupe)', 'var(--color-stone)', '#cfc4b5']

type VoteDimensionProps = {
  dim: VoteDimensionView
  /** The option slug the current user has picked in this dimension, if any. */
  selected?: string
  /** When provided, options become clickable vote controls. */
  onSelect?: (optionSlug: string) => void
  disabled?: boolean
}

/** A community vote dimension as a segmented distribution bar + legend.
 *  Read-only by default; interactive when `onSelect` is provided. */
export function VoteDimension({ dim, selected, onSelect, disabled }: VoteDimensionProps) {
  const lead = dim.options.reduce((a, b) => (b.pct > a.pct ? b : a), dim.options[0])
  const ordered = [...dim.options].sort((a, b) => b.pct - a.pct)
  const colorFor = (label: string) => {
    const rank = ordered.findIndex((o) => o.label === label)
    return TINTS[rank] ?? 'var(--color-stone)'
  }
  const interactive = Boolean(onSelect)

  return (
    <div className="border-t border-border py-[1.1rem]">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-text">
          {dim.dimension}
        </span>
        <span className="whitespace-nowrap text-xs text-text-secondary">{dim.total} votes</span>
      </div>

      <div className="mb-2.5 mt-3 flex h-2 gap-0.5 overflow-hidden rounded-md">
        {dim.options.map((o) => (
          <span
            key={o.label}
            title={`${o.label} · ${o.pct}%`}
            style={{ width: `${o.pct}%`, background: colorFor(o.label) }}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {dim.options.map((o) => {
          const isLead = o.label === lead?.label
          const isSelected = o.optionSlug != null && o.optionSlug === selected
          const content = (
            <>
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: colorFor(o.label) }}
              />
              {o.label}
              <span className={cn('tabular-nums', (isLead || isSelected) && 'font-medium')}>
                {o.pct}%
              </span>
            </>
          )

          if (interactive && o.optionSlug) {
            return (
              <button
                key={o.label}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => onSelect?.(o.optionSlug!)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors duration-200',
                  isSelected
                    ? 'border-accent bg-accent/10 text-text'
                    : 'border-transparent text-text-secondary hover:border-border hover:text-text',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                {content}
              </button>
            )
          }

          return (
            <span
              key={o.label}
              className={cn('inline-flex items-center gap-1.5 text-xs', isLead ? 'text-text' : 'text-text-secondary')}
            >
              {content}
            </span>
          )
        })}
      </div>
    </div>
  )
}
