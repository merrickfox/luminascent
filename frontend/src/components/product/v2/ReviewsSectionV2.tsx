import type { ProductV2View } from '../../../lib/productViewV2'
import { DataCard } from '../../ui/DataCard'
import { SectionTitle } from '../../ui/SectionTitle'

type ReviewsSectionV2Props = {
  rating: ProductV2View['rating']
  ratingDist: ProductV2View['ratingDist']
  reviews: ProductV2View['reviews']
}

export function ReviewsSectionV2({ rating, ratingDist, reviews }: ReviewsSectionV2Props) {
  return (
    <div>
      <SectionTitle hint={rating.count > 0 ? `${rating.count} ratings` : undefined}>
        What members say
      </SectionTitle>

      <div className="grid grid-cols-1 items-start gap-10 md:grid-cols-[5fr_7fr] md:gap-14">
        <DataCard>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[3.5rem] leading-none">
              {rating.avg != null ? rating.avg.toFixed(1) : '—'}
            </span>
            <span className="text-sm text-text-secondary">/ 5</span>
          </div>

          {ratingDist ? (
            <div className="mt-6 flex flex-col gap-2.5">
              {ratingDist.map((r) => (
                <div
                  key={r.stars}
                  className="grid items-center gap-3"
                  style={{ gridTemplateColumns: '12px 1fr 32px' }}
                >
                  <span className="text-xs text-text-secondary">{r.stars}</span>
                  <span className="relative h-[3px] rounded-sm bg-border">
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm bg-accent"
                      style={{ width: `${r.pct}%` }}
                    />
                  </span>
                  <span className="text-right text-xs tabular-nums text-text-secondary">
                    {r.pct}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-6 text-xs text-text-secondary">
              Per-star breakdown isn’t available yet.
            </p>
          )}
        </DataCard>

        <div className="flex flex-col gap-8">
          {reviews.length > 0 ? (
            reviews.map((rv, i) => (
              <article key={`${rv.author}-${i}`} className="border-t border-border pt-6">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm">{rv.author}</span>
                  {rv.rating != null ? (
                    <span className="text-sm text-accent">{rv.rating.toFixed(1)}</span>
                  ) : null}
                </div>
                {rv.title ? (
                  <h4 className="mb-2 mt-2 font-display text-xl font-normal">{rv.title}</h4>
                ) : (
                  <div className="mt-2" />
                )}
                <p className="m-0 leading-relaxed text-text-secondary">{rv.body}</p>
              </article>
            ))
          ) : (
            <p className="text-sm text-text-secondary">
              No reviews yet — be the first to share your impression.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
