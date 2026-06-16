import type { ProductV2View } from '../../../lib/productViewV2'
import { SectionTitle } from '../../ui/SectionTitle'
import { MediaPlaceholder } from './MediaPlaceholder'

type SmellsSimilarProps = {
  similar: ProductV2View['similar']
}

export function SmellsSimilar({ similar }: SmellsSimilarProps) {
  return (
    <div>
      <SectionTitle hint="By shared notes & accords">Smells similar</SectionTitle>
      {similar.length > 0 ? (
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {similar.map((s, i) => (
            <a
              key={`${s.name}-${i}`}
              href={s.url ?? '#'}
              target={s.url ? '_blank' : undefined}
              rel={s.url ? 'noreferrer noopener' : undefined}
              className="text-text"
            >
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
                <div className="relative">
                  <MediaPlaceholder name={s.name} tone={s.tone} />
                  <span className="absolute right-2.5 top-2.5 rounded-full bg-bg/90 px-2.5 py-1 text-xs tabular-nums text-text backdrop-blur-sm">
                    {s.match != null ? `${s.match}% match` : 'Member pick'}
                  </span>
                </div>
                <div className="p-4">
                  {s.brand ? (
                    <span className="text-xs uppercase tracking-[0.06em] text-text-secondary">
                      {s.brand}
                    </span>
                  ) : null}
                  <h3 className="mt-1.5 font-display text-lg font-normal">{s.name}</h3>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          No similar candles linked yet — community suggestions appear here.
        </p>
      )}
    </div>
  )
}
