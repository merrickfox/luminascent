import { useState } from 'react'
import { ArrowUpRight, Bookmark, Heart } from 'lucide-react'
import type { StockistView } from '../../../lib/productViewV2'
import { Button } from '../../ui/Button'
import { Label } from '../../ui/Label'

type WhereToBuyPanelProps = {
  fromPrice: string | null
  stockists: StockistView[]
}

/** Outbound "where to buy" — Luminascent links to the house & stockists; it is
 *  not the retailer. Save / Collection are local-only placeholders for now. */
export function WhereToBuyPanel({ fromPrice, stockists }: WhereToBuyPanelProps) {
  const [saved, setSaved] = useState(false)

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
      <div className="flex items-center justify-between gap-4 bg-surface px-6 py-5">
        <div>
          <Label className="mb-1 block">Where to buy</Label>
          <span className="font-display text-2xl">
            {fromPrice ? `From ${fromPrice}` : 'Price unavailable'}
          </span>
        </div>
        <div className="flex gap-2.5">
          <Button
            variant="secondary"
            iconOnly
            aria-label={saved ? 'Saved' : 'Save'}
            onClick={() => setSaved((s) => !s)}
          >
            <Heart className="h-[18px] w-[18px]" fill={saved ? 'currentColor' : 'none'} />
          </Button>
          <Button variant="secondary">
            <Bookmark className="h-4 w-4" /> Collection
          </Button>
        </div>
      </div>

      {stockists.length > 0 ? (
        <div className="border-t border-border">
          {stockists.map((s, i) => (
            <a
              key={`${s.name}-${i}`}
              href={s.url ?? '#'}
              target={s.url ? '_blank' : undefined}
              rel={s.url ? 'noreferrer noopener' : undefined}
              className={`flex items-center justify-between gap-4 px-6 py-3.5 text-text ${
                i === 0 ? '' : 'border-t border-border'
              }`}
            >
              <span className="flex flex-col">
                <span className="text-sm">{s.name}</span>
                <span className="text-xs text-text-secondary">{s.kind}</span>
              </span>
              <span className="inline-flex items-center gap-2.5 text-text-secondary">
                {s.price ? <span className="text-sm text-text">{s.price}</span> : null}
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </a>
          ))}
        </div>
      ) : null}

      <p className="m-0 border-t border-border bg-bg px-6 py-3.5 text-xs text-text-secondary">
        Luminascent is a guide, not a shop — we link you to the house and trusted stockists.
      </p>
    </div>
  )
}
