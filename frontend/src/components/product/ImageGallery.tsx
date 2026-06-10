import { useState } from 'react'
import type { ProductImage } from '../../types/api'
import { cn } from '../../lib/utils'

type ImageGalleryProps = {
  images: ProductImage[]
  fallbackUrl?: string | null
  alt: string
}

export function ImageGallery({ images, fallbackUrl, alt }: ImageGalleryProps) {
  const sorted = [...images].sort((a, b) => a.position - b.position)
  const primary = sorted.find((image) => image.is_primary) ?? sorted[0]
  const [activeUrl, setActiveUrl] = useState(primary?.url ?? fallbackUrl ?? null)

  if (!activeUrl) {
    return (
      <div className="flex aspect-[4/5] w-full min-w-0 items-center justify-center rounded-[var(--radius-card)] border border-border bg-stone/20">
        <span className="font-display text-lg text-text-secondary/50">No image available</span>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 max-w-full">
      <div className="aspect-[4/5] w-full min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-stone/20">
        <img
          src={activeUrl}
          alt={alt}
          className="h-full w-full max-w-full object-cover"
        />
      </div>

      {sorted.length > 1 ? (
        <div
          className="mt-4 w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
          role="listbox"
          aria-label="Product images"
        >
          <div className="flex w-max gap-2.5 pb-1 sm:gap-3">
            {sorted.map((image) => (
              <button
                key={image.id}
                type="button"
                role="option"
                aria-selected={activeUrl === image.url}
                onClick={() => setActiveUrl(image.url)}
                className={cn(
                  'h-16 w-14 shrink-0 overflow-hidden rounded-md border transition-colors duration-300 sm:h-20 sm:w-16',
                  activeUrl === image.url
                    ? 'border-accent'
                    : 'border-border hover:border-text-secondary',
                )}
              >
                <img src={image.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
