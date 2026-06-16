import type { ProductV2View } from '../../../lib/productViewV2'
import { DataCard } from '../../ui/DataCard'
import { Label } from '../../ui/Label'

type SpecsGridProps = {
  specs: ProductV2View['specs']
}

/** 4-up specification grid. Hairlines come from a 1px gap over a border-tinted
 *  background, so cells stay clean as they wrap. Unbacked cells show a dash. */
export function SpecsGrid({ specs }: SpecsGridProps) {
  return (
    <DataCard flush>
      <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-4">
        {specs.map((s) => (
          <div key={s.label} className="bg-surface p-6">
            <Label className="mb-2 block">{s.label}</Label>
            {s.value ? (
              <span className="font-display text-xl text-text">{s.value}</span>
            ) : (
              <span
                className="font-display text-xl text-text-secondary/50"
                title="Not recorded yet"
              >
                —
              </span>
            )}
          </div>
        ))}
      </div>
    </DataCard>
  )
}
