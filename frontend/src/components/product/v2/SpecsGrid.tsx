import type { ProductV2View } from '../../../lib/productViewV2'
import { cn } from '../../../lib/utils'
import { DataCard } from '../../ui/DataCard'
import { Label } from '../../ui/Label'

type SpecsGridProps = {
  specs: ProductV2View['specs']
}

// Column count tracks how many cells actually have data, so the row fills out
// cleanly whether there's one field or eight (indexed by count, capped at 4).
const COL_CLASS = [
  'grid-cols-1',
  'grid-cols-1',
  'grid-cols-2',
  'grid-cols-2 md:grid-cols-3',
  'grid-cols-2 md:grid-cols-4',
] as const

/** Specification grid — only cells with data are shown. Hairlines are drawn per
 *  cell (top/left) with a 1px negative offset so they tuck under the card border;
 *  this keeps partial rows clean and looks good at any count, even a single field. */
export function SpecsGrid({ specs }: SpecsGridProps) {
  const filled = specs.filter((s) => s.value)
  if (filled.length === 0) return null

  const colClass = COL_CLASS[Math.min(filled.length, 4)]

  return (
    <DataCard flush>
      <div className={cn('-ml-px -mt-px grid', colClass)}>
        {filled.map((s) => (
          <div key={s.label} className="border-l border-t border-border bg-surface p-6">
            <Label className="mb-2 block">{s.label}</Label>
            <span
              className={cn(
                'font-display text-xl text-text',
                s.lowercase && 'lowercase',
                s.capitalize && 'capitalize',
              )}
            >
              {s.value}
            </span>
          </div>
        ))}
      </div>
    </DataCard>
  )
}
