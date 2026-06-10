import type { ScentProfileAccord } from '../../types/api'
import { Label } from '../ui/Label'

type AccordListProps = {
  accords: ScentProfileAccord[]
}

export function AccordList({ accords }: AccordListProps) {
  if (accords.length === 0) return null

  const sorted = [...accords].sort(
    (a, b) => (a.position_index ?? 0) - (b.position_index ?? 0),
  )

  return (
    <div>
      <Label className="mb-4 block">Accords</Label>
      <div className="space-y-3">
        {sorted.map((item) => (
          <div
            key={item.accord.slug}
            className="flex min-w-0 items-center justify-between gap-3 sm:gap-4"
          >
            <span className="min-w-0 truncate text-text">{item.accord.name}</span>
            {item.strength_score != null ? (
              <div className="flex shrink-0 items-center gap-2">
                <div className="h-px w-16 bg-border sm:w-24">
                  <div
                    className="h-px bg-accent"
                    style={{ width: `${Math.min(item.strength_score, 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
