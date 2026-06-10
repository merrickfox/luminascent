import type { ProductRatingSummary } from '../../types/api'
import { Label } from '../ui/Label'

type RatingStatProps = {
  rating: ProductRatingSummary | null
}

export function RatingStat({ rating }: RatingStatProps) {
  if (!rating || rating.rating_count === 0) return null

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Label>Rating</Label>
      <span className="font-display text-3xl text-text">
        {rating.rating_avg?.toFixed(1) ?? '—'}
      </span>
      <span className="text-sm text-text-secondary">
        from {rating.rating_count} {rating.rating_count === 1 ? 'review' : 'reviews'}
      </span>
    </div>
  )
}
