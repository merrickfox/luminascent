import { Link, useParams } from 'react-router-dom'
import { PageSection } from '../components/layout/PageSection'
import { AccordList } from '../components/product/AccordList'
import { ImageGallery } from '../components/product/ImageGallery'
import { RatingStat } from '../components/product/RatingStat'
import { ReviewList } from '../components/product/ReviewList'
import { ScentPyramid } from '../components/product/ScentPyramid'
import { SizeList } from '../components/product/SizeList'
import { EmptyState } from '../components/ui/EmptyState'
import { Eyebrow } from '../components/ui/Eyebrow'
import { Label } from '../components/ui/Label'
import { Spinner } from '../components/ui/Spinner'
import { useProduct } from '../hooks/useProduct'

export function ProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data, isLoading, isError } = useProduct(slug)

  if (isLoading) return <Spinner />

  if (isError || !data) {
    return (
      <PageSection>
        <EmptyState
          title="Product not found"
          description="This item may not yet be in our collection."
        />
        <div className="mt-8 text-center">
          <Link to="/brands" className="text-sm text-text-secondary hover:text-text">
            Browse brands
          </Link>
        </div>
      </PageSection>
    )
  }

  const { product, brand, category, scent_profile, notes, accords, rating, reviews, images, sizes } =
    data

  const summary = scent_profile?.summary

  return (
    <>
      <PageSection className="border-b border-border">
        <div className="mb-6">
          {brand ? (
            <Link
              to={`/brands/${brand.slug}`}
              className="text-sm text-text-secondary hover:text-accent"
            >
              {brand.name}
            </Link>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-8 sm:gap-12 lg:grid-cols-[minmax(0,580px)_1fr] lg:items-start lg:gap-16">
          <div className="min-w-0 lg:max-w-[580px]">
            <ImageGallery
              images={images}
              fallbackUrl={product.image_url}
              alt={product.name}
            />
          </div>

          <div className="flex min-w-0 flex-col">
            <Eyebrow>{category.name}</Eyebrow>
            <h1 className="break-words text-3xl font-medium leading-tight sm:text-4xl md:text-5xl lg:text-6xl">
              {product.name}
            </h1>

            <div className="mt-5 space-y-4 sm:mt-6">
              <RatingStat rating={rating} />

              {summary ? (
                <p className="font-display text-lg italic text-text-secondary sm:text-xl">
                  {summary}
                </p>
              ) : null}

              {product.description ? (
                <p className="break-words text-text-secondary leading-relaxed">
                  {product.description}
                </p>
              ) : null}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 text-sm text-text-secondary sm:mt-8 sm:flex sm:flex-wrap sm:gap-6">
              {product.release_year ? (
                <div>
                  <Label className="mb-1 block">Released</Label>
                  <span>{product.release_year}</span>
                </div>
              ) : null}
              {product.wax_type ? (
                <div>
                  <Label className="mb-1 block">Wax</Label>
                  <span>{product.wax_type}</span>
                </div>
              ) : null}
              {product.vessel_material ? (
                <div>
                  <Label className="mb-1 block">Vessel</Label>
                  <span>{product.vessel_material}</span>
                </div>
              ) : null}
              {product.is_discontinued ? (
                <div>
                  <Label className="mb-1 block">Status</Label>
                  <span className="text-error">Discontinued</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </PageSection>

      {(notes.length > 0 || accords.length > 0 || sizes.length > 0) && (
        <PageSection className="border-b border-border">
          <div className="grid min-w-0 grid-cols-1 gap-12 sm:gap-16 lg:grid-cols-2">
            {notes.length > 0 ? (
              <div className="min-w-0">
                <h2 className="mb-6 font-display text-2xl sm:mb-8 sm:text-3xl">Scent profile</h2>
                <ScentPyramid notes={notes} />
              </div>
            ) : null}

            <div className="min-w-0 space-y-10 sm:space-y-12">
              <AccordList accords={accords} />
              <SizeList sizes={sizes} />
            </div>
          </div>
        </PageSection>
      )}

      {reviews.length > 0 ? (
        <PageSection narrow>
          <h2 className="mb-8 font-display text-2xl sm:mb-10 sm:text-3xl">Community</h2>
          <ReviewList reviews={reviews} />
        </PageSection>
      ) : null}
    </>
  )
}
