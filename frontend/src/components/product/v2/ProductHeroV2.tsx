import { Link } from 'react-router-dom'
import type { ProductImage } from '../../../types/api'
import type { ProductV2View } from '../../../lib/productViewV2'
import { ImageGallery } from '../ImageGallery'
import { Tag } from '../../ui/Tag'
import { Stat } from './Stat'
import { WhereToBuyPanel } from './WhereToBuyPanel'

type ProductHeroV2Props = {
  view: ProductV2View
  images: ProductImage[]
  fallbackUrl: string | null
}

export function ProductHeroV2({ view, images, fallbackUrl }: ProductHeroV2Props) {
  const burnTime = view.specs.find((s) => s.label === 'Burn time')?.value ?? null
  const burnValue = burnTime ? burnTime.replace(' hrs', '') : null

  return (
    <div className="grid grid-cols-1 items-start gap-10 md:grid-cols-[5fr_7fr] md:gap-14">
      <ImageGallery images={images} fallbackUrl={fallbackUrl} alt={view.name} />

      <div className="min-w-0">
        {view.brand ? (
          view.brandSlug ? (
            <Link
              to={`/brands/${view.brandSlug}`}
              className="text-xs font-medium uppercase tracking-[0.12em] text-text-secondary hover:text-text"
            >
              {view.brand}
            </Link>
          ) : (
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
              {view.brand}
            </span>
          )
        ) : null}

        <h1 className="mt-3 text-3xl leading-tight md:text-4xl lg:text-5xl">{view.name}</h1>

        {view.scentType ? (
          <p className="mt-2.5 font-display text-xl italic text-text-secondary">{view.scentType}</p>
        ) : null}

        {/* quick stat row */}
        <div className="mt-7 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-6">
          <Stat
            value={view.rating.avg != null ? view.rating.avg.toFixed(1) : null}
            label={view.rating.count > 0 ? `${view.rating.count} ratings` : 'No ratings yet'}
            icon="star"
          />
          <Stat value={burnValue} unit="hrs" label="Burn time" />
          <Stat value={view.year != null ? String(view.year) : null} label="Released" />
          <Stat value={view.perfumer} label="Perfumer" wide />
        </div>

        {view.accordChips.length > 0 ? (
          <div className="mt-7 flex flex-wrap gap-2">
            {view.accordChips.map((a) => (
              <Tag key={a.name} variant="outline" color={a.color}>
                {a.name}
              </Tag>
            ))}
          </div>
        ) : null}

        {view.summary ? (
          <p className="mt-6 max-w-[540px] leading-relaxed text-text-secondary">{view.summary}</p>
        ) : null}

        <div className="mt-8">
          <WhereToBuyPanel fromPrice={view.fromPrice} stockists={view.stockists} />
        </div>
      </div>
    </div>
  )
}
