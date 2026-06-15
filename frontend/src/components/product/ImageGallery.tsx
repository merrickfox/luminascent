import { useState } from 'react'
import type { ProductImage } from '../../types/api'
import { cn } from '../../lib/utils'

type ImageGalleryProps = {
  images: ProductImage[]
  fallbackUrl?: string | null
  alt: string
}

function ThumbnailButton({
  image,
  isActive,
  onSelect,
  className,
}: {
  image: ProductImage
  isActive: boolean
  onSelect: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isActive}
      onClick={onSelect}
      className={cn(
        'shrink-0 overflow-hidden border transition-colors duration-300',
        isActive ? 'border-text' : 'border-border hover:border-text-secondary',
        className,
      )}
    >
      <img src={image.url} alt="" className="h-full w-full object-cover" />
    </button>
  )
}

export function ImageGallery({ images, fallbackUrl, alt }: ImageGalleryProps) {
  const sorted = [...images].sort((a, b) => a.position - b.position)
  const primary = sorted.find((image) => image.is_primary) ?? sorted[0]
  const [activeUrl, setActiveUrl] = useState(primary?.url ?? fallbackUrl ?? null)

  if (!activeUrl) {
    return (
      <div className="flex aspect-[4/5] w-full min-w-0 items-center justify-center border border-border bg-stone/20">
        <span className="font-display text-lg text-text-secondary/50">No image available</span>
      </div>
    )
  }

  const hasMultiple = sorted.length > 1

  return (
    <div className="w-full min-w-0 max-w-full">
      <div
        className={cn(
          'flex gap-3 sm:gap-4',
          hasMultiple ? 'lg:gap-4' : '',
        )}
      >
        {hasMultiple ? (
          <div
            className="hidden shrink-0 flex-col gap-2 lg:flex"
            role="listbox"
            aria-label="Product images"
          >
            {sorted.map((image) => (
              <ThumbnailButton
                key={image.id}
                image={image}
                isActive={activeUrl === image.url}
                onSelect={() => setActiveUrl(image.url)}
                className="h-16 w-16"
              />
            ))}
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="aspect-[4/5] w-full min-w-0 overflow-hidden border border-border bg-stone/20">
            <img
              src={activeUrl}
              alt={alt}
              className="h-full w-full max-w-full object-contain"
            />
          </div>
        </div>
      </div>

      {hasMultiple ? (
        <div
          className="mt-4 w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] lg:hidden"
          role="listbox"
          aria-label="Product images"
        >
          <div className="flex w-max gap-2.5 pb-1 sm:gap-3">
            {sorted.map((image) => (
              <ThumbnailButton
                key={image.id}
                image={image}
                isActive={activeUrl === image.url}
                onSelect={() => setActiveUrl(image.url)}
                className="h-16 w-14 sm:h-20 sm:w-16"
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
