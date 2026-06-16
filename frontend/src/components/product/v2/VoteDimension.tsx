import type { VoteDimensionView } from '../../../lib/productViewV2'

// Leading option takes the accent; the rest step down through warm neutrals.
const TINTS = ['var(--color-accent)', 'var(--color-taupe)', 'var(--color-stone)', '#cfc4b5']

type VoteDimensionProps = {
  dim: VoteDimensionView
}

/** A community vote dimension as a segmented distribution bar + legend. */
export function VoteDimension({ dim }: VoteDimensionProps) {
  const lead = dim.options.reduce((a, b) => (b.pct > a.pct ? b : a), dim.options[0])
  const ordered = [...dim.options].sort((a, b) => b.pct - a.pct)
  const colorFor = (label: string) => {
    const rank = ordered.findIndex((o) => o.label === label)
    return TINTS[rank] ?? 'var(--color-stone)'
  }

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
          return (
            <span
              key={o.label}
              className={`inline-flex items-center gap-1.5 text-xs ${
                isLead ? 'text-text' : 'text-text-secondary'
              }`}
            >
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: colorFor(o.label) }}
              />
              {o.label}
              <span className={`tabular-nums ${isLead ? 'font-medium' : ''}`}>{o.pct}%</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
