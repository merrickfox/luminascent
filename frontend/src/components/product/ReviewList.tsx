import type { Review } from '../../types/api'
import { Label } from '../ui/Label'

type ReviewListProps = {
  reviews: Review[]
}

export function ReviewList({ reviews }: ReviewListProps) {
  if (reviews.length === 0) return null

  return (
    <div>
      <Label className="mb-6 block">Reviews</Label>
      <div className="space-y-8">
        {reviews.map((review) => (
          <article key={review.id} className="border-t border-border pt-8 first:border-t-0 first:pt-0">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <p className="text-sm text-text">
                {review.author_name ?? 'Anonymous'}
              </p>
              {review.rating != null ? (
                <span className="text-sm text-accent">{review.rating.toFixed(1)}</span>
              ) : null}
            </div>
            {review.title ? (
              <h4 className="mb-2 font-display text-xl text-text">{review.title}</h4>
            ) : null}
            <p className="text-text-secondary leading-relaxed">{review.body}</p>
          </article>
        ))}
      </div>
    </div>
  )
}
