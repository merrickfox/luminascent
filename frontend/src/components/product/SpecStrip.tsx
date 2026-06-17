import { Clock, MapPin, Ruler, Scale } from 'lucide-react'
import type { Brand, ProductSize } from '../../types/api'
import { iconMd } from '../../lib/icons'
import { cn, formatSize } from '../../lib/utils'
import { Container } from '../layout/Container'

type SpecStripProps = {
  primarySize: ProductSize | null
  brand: Brand | null
}

type SpecItem = {
  icon: React.ReactNode
  label: string
  value: string
  lowercase?: boolean
}

function SpecCell({ icon, label, value, lowercase }: SpecItem) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 px-4 py-6 text-center sm:px-6">
      <div className="text-text-secondary">{icon}</div>
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-secondary">
        {label}
      </span>
      <span className={cn('text-sm text-text', lowercase && 'lowercase')}>{value}</span>
    </div>
  )
}

export function SpecStrip({ primarySize, brand }: SpecStripProps) {
  const burnTime = primarySize?.burn_time_hours
    ? `${primarySize.burn_time_hours} hours`
    : '—'

  const waxWeight = primarySize?.size_grams
    ? `${primarySize.size_grams}g`
    : formatSize(primarySize ?? { size_value: null, size_unit: null, size_grams: null }) ?? '—'

  const specs: SpecItem[] = [
    { icon: <Clock {...iconMd} />, label: 'Burn time', value: burnTime },
    { icon: <Scale {...iconMd} />, label: 'Wax weight', value: waxWeight, lowercase: true },
    { icon: <Ruler {...iconMd} />, label: 'Dimensions', value: '—' },
    { icon: <MapPin {...iconMd} />, label: 'Made in', value: brand?.country ?? '—' },
  ]

  return (
    <div className="border-y border-border bg-surface/50">
      <Container>
        <div className="flex flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
          {specs.map((spec) => (
            <SpecCell key={spec.label} {...spec} />
          ))}
        </div>
      </Container>
    </div>
  )
}
