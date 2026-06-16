import type { ProductV2View } from '../../../lib/productViewV2'
import { DataCard } from '../../ui/DataCard'
import { Label } from '../../ui/Label'
import { NoteSwatch } from '../../ui/NoteSwatch'
import { SectionTitle } from '../../ui/SectionTitle'
import { StrengthBar } from './StrengthBar'

type CompositionCardProps = {
  pyramid: ProductV2View['pyramid']
  accords: ProductV2View['accords']
}

export function CompositionCard({ pyramid, accords }: CompositionCardProps) {
  return (
    <DataCard>
      <SectionTitle hint="Scent pyramid">Composition</SectionTitle>

      {pyramid.length > 0 ? (
        pyramid.map((group, i) => (
          <div
            key={group.stage}
            className={`flex gap-6 py-4 ${i === 0 ? '' : 'border-t border-border'}`}
          >
            <div className="w-16 shrink-0 pt-1">
              <Label>{group.stage}</Label>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-3.5">
              {group.notes.map((n) => (
                <NoteSwatch key={n.name} name={n.name} color={n.color} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="text-sm text-text-secondary">Notes not catalogued yet.</p>
      )}

      {accords.length > 0 ? (
        <div className="mt-8 border-t border-border pt-6">
          <Label className="mb-2 block">Main accords</Label>
          {accords.map((a) => (
            <StrengthBar key={a.name} name={a.name} color={a.color} pct={a.pct} />
          ))}
        </div>
      ) : null}
    </DataCard>
  )
}
