import type { ProductSize } from '../../types/api'
import { cn, formatPrice, formatSize } from '../../lib/utils'
import { Label } from '../ui/Label'

type SizeListProps = {
  sizes: ProductSize[]
}

export function SizeList({ sizes }: SizeListProps) {
  if (sizes.length === 0) return null

  const sorted = [...sizes].sort((a, b) => a.position - b.position)

  return (
    <div>
      <Label className="mb-4 block">Sizes</Label>
      <div className="divide-y divide-border border border-border rounded-[var(--radius-card)]">
        {sorted.map((size) => {
          const sizeLabel = formatSize(size)
          const priceLabel = formatPrice(size.price_amount, size.price_currency)

          return (
            <div
              key={size.id}
              className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5"
            >
              <div className="min-w-0">
                <p className={cn('text-text', sizeLabel && 'lowercase')}>{sizeLabel ?? 'Standard'}</p>
                {size.burn_time_hours ? (
                  <p className="mt-1 text-sm text-text-secondary">
                    {size.burn_time_hours} hour burn
                  </p>
                ) : null}
              </div>
              {priceLabel ? (
                <p className="shrink-0 text-text sm:text-right">{priceLabel}</p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
