import { Gift, Heart, Lock, Package } from 'lucide-react'
import type { ProductSize } from '../../types/api'
import { iconMd, iconSm } from '../../lib/icons'
import { formatPrice } from '../../lib/utils'
import { Button } from '../ui/Button'

type PurchasePanelProps = {
  primarySize: ProductSize | null
}

function TrustBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex h-8 w-8 items-center justify-center text-text-secondary">{icon}</div>
      <span className="text-[10px] font-medium uppercase leading-tight tracking-[0.08em] text-text-secondary">
        {label}
      </span>
    </div>
  )
}

function getAvailabilityLabel(size: ProductSize | null): string {
  if (!size?.availability) return 'In stock'
  const normalized = size.availability.toLowerCase()
  if (normalized.includes('out') || normalized.includes('unavailable')) return 'Out of stock'
  return size.availability
}

function isInStock(size: ProductSize | null): boolean {
  if (!size?.availability) return true
  const normalized = size.availability.toLowerCase()
  return !normalized.includes('out') && !normalized.includes('unavailable')
}

export function PurchasePanel({ primarySize }: PurchasePanelProps) {
  const priceLabel = formatPrice(primarySize?.price_amount ?? null, primarySize?.price_currency ?? null)
  const inStock = isInStock(primarySize)

  return (
    <div className="space-y-6">
      <p className="font-display text-2xl text-text sm:text-3xl">
        {priceLabel ?? 'Price on request'}
      </p>

      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${inStock ? 'bg-success' : 'bg-error'}`}
          aria-hidden
        />
        <span className="text-sm text-text-secondary">{getAvailabilityLabel(primarySize)}</span>
      </div>

      <div className="flex gap-3">
        <Button className="flex-1">Add to bag</Button>
        <Button variant="secondary" className="w-12 shrink-0 px-0" aria-label="Save">
          <Heart {...iconSm} />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 border-t border-border pt-6">
        <TrustBadge icon={<Package {...iconMd} />} label="Complimentary samples" />
        <TrustBadge icon={<Gift {...iconMd} />} label="Complimentary gift wrapping" />
        <TrustBadge icon={<Lock {...iconMd} />} label="Secure payments" />
      </div>
    </div>
  )
}
