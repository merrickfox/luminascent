import { Link } from 'react-router-dom'
import type { Product } from '../../types/api'
import { cn } from '../../lib/utils'
import { Card } from '../ui/Card'
import { Label } from '../ui/Label'

type ProductCardProps = {
  product: Product
  brandName?: string | null
  categoryName?: string | null
  variant?: 'default' | 'compact'
  className?: string
}

export function ProductCard({
  product,
  brandName,
  categoryName,
  variant = 'default',
  className,
}: ProductCardProps) {
  const compact = variant === 'compact'

  return (
    <Link
      to={`/products/${product.slug}`}
      className={cn('group flex h-full flex-col', className)}
    >
      <Card className="flex h-full flex-col overflow-hidden transition-colors duration-300 group-hover:border-accent/40">
        <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-stone/30">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span
                className={cn(
                  'font-display text-text-secondary/50',
                  compact ? 'text-sm sm:text-base' : 'text-lg',
                )}
              >
                No image
              </span>
            </div>
          )}
        </div>

        <div
          className={cn(
            'flex flex-1 flex-col',
            compact ? 'gap-1 p-3 sm:gap-1.5 sm:p-4' : 'gap-2 p-5',
          )}
        >
          {brandName ? (
            <Label className="line-clamp-1 normal-case tracking-normal">{brandName}</Label>
          ) : null}

          <h3
            className={cn(
              'line-clamp-2 font-display leading-snug text-text transition-colors duration-300 group-hover:text-accent',
              compact ? 'min-h-[2.5rem] text-sm sm:min-h-[2.75rem] sm:text-base' : 'min-h-[3.25rem] text-lg sm:min-h-[3.5rem] sm:text-xl',
            )}
          >
            {product.name}
          </h3>

          {categoryName ? (
            <p
              className={cn(
                'line-clamp-1 text-text-secondary',
                compact ? 'text-xs sm:text-sm' : 'text-sm',
              )}
            >
              {categoryName}
            </p>
          ) : (
            <span className={compact ? 'min-h-[1.125rem] sm:min-h-[1.25rem]' : 'min-h-[1.25rem]'} aria-hidden />
          )}
        </div>
      </Card>
    </Link>
  )
}
