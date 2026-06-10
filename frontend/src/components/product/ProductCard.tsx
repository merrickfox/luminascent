import { Link } from 'react-router-dom'
import type { Product } from '../../types/api'
import { Card } from '../ui/Card'
import { Label } from '../ui/Label'

type ProductCardProps = {
  product: Product
  brandName?: string | null
  categoryName?: string | null
  variant?: 'default' | 'compact'
}

export function ProductCard({
  product,
  brandName,
  categoryName,
  variant = 'default',
}: ProductCardProps) {
  const compact = variant === 'compact'

  return (
    <Link to={`/products/${product.slug}`} className="group block">
      <Card className="overflow-hidden transition-colors duration-300 group-hover:border-accent/40">
        <div className="aspect-square overflow-hidden bg-stone/30">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span
                className={
                  compact
                    ? 'font-display text-sm text-text-secondary/50 sm:text-base'
                    : 'font-display text-lg text-text-secondary/50'
                }
              >
                No image
              </span>
            </div>
          )}
        </div>

        <div className={compact ? 'space-y-1 p-3 sm:space-y-1.5 sm:p-4' : 'space-y-2 p-5'}>
          {brandName ? <Label className="normal-case tracking-normal">{brandName}</Label> : null}
          <h3
            className={
              compact
                ? 'break-words font-display text-sm leading-snug text-text transition-colors duration-300 group-hover:text-accent sm:text-base'
                : 'break-words font-display text-lg leading-snug text-text transition-colors duration-300 group-hover:text-accent sm:text-xl'
            }
          >
            {product.name}
          </h3>
          {categoryName ? (
            <p className={compact ? 'text-xs text-text-secondary sm:text-sm' : 'text-sm text-text-secondary'}>
              {categoryName}
            </p>
          ) : null}
        </div>
      </Card>
    </Link>
  )
}
