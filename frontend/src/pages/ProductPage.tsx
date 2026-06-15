import { Link, useParams } from 'react-router-dom'
import { Breadcrumb } from '../components/layout/Breadcrumb'
import { PageSection } from '../components/layout/PageSection'
import { ImageGallery } from '../components/product/ImageGallery'
import { NoteColumns } from '../components/product/NoteColumns'
import { PurchasePanel } from '../components/product/PurchasePanel'
import { RelatedProducts } from '../components/product/RelatedProducts'
import { SpecStrip } from '../components/product/SpecStrip'
import { EmptyState } from '../components/ui/EmptyState'
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

  const { product, brand, category, scent_profile, notes, accords, images, sizes } = data

  const primarySize = sizes.find((size) => size.is_primary) ?? sizes[0] ?? null
  const scentType =
    accords[0]?.accord.name ?? scent_profile?.summary ?? null

  const breadcrumbItems = [
    { label: 'Home', to: '/' },
    { label: category.name, to: '#' },
    ...(brand ? [{ label: brand.name, to: `/brands/${brand.slug}` }] : []),
    { label: product.name },
  ]

  const hasDetailsSection =
    product.description ||
    product.wax_type ||
    product.vessel_material ||
    notes.length > 0 ||
    accords.length > 0

  const brandLink = brand ? (
    <Link
      to={`/brands/${brand.slug}`}
      className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-secondary transition-colors duration-300 hover:text-text"
    >
      {brand.name}
    </Link>
  ) : null

  const productTitle = (
    <h1 className="break-words text-3xl font-medium leading-tight md:text-4xl lg:text-5xl">
      {product.name}
    </h1>
  )

  const scentLine = scentType ? (
    <p className="font-display text-lg italic text-text-secondary sm:text-xl">{scentType}</p>
  ) : null

  return (
    <>
      <PageSection className="!py-6 sm:!py-8">
        <Breadcrumb items={breadcrumbItems} className="mb-8 sm:mb-10" />
      </PageSection>

      <PageSection className="!pt-0 border-b border-border">
        <div className="grid min-w-0 grid-cols-1 gap-8 sm:grid-cols-2 sm:items-start sm:gap-x-8 md:gap-x-12 lg:gap-x-12 xl:gap-x-16">
          <div className="order-1 min-w-0 sm:hidden">
            {brandLink}
            {productTitle}
          </div>

          <div className="order-2 min-w-0 sm:col-start-1 sm:row-start-1">
            <ImageGallery
              images={images}
              fallbackUrl={product.image_url}
              alt={product.name}
            />
          </div>

          {scentLine ? <div className="order-3 min-w-0 sm:hidden">{scentLine}</div> : null}

          <div className="order-4 min-w-0 sm:hidden">
            <PurchasePanel primarySize={primarySize} />
          </div>

          <div className="hidden min-w-0 flex-col sm:col-start-2 sm:row-start-1 sm:flex">
            {brandLink}
            {productTitle}
            {scentLine ? <div className="mt-3">{scentLine}</div> : null}
            <div className="mt-8">
              <PurchasePanel primarySize={primarySize} />
            </div>
          </div>
        </div>
      </PageSection>

      {hasDetailsSection ? (
        <PageSection className="border-b border-border">
          <div className="grid min-w-0 grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-0">
            <div className="min-w-0 lg:border-r lg:border-border lg:pr-12 xl:pr-16">
              <Label className="mb-4 block">Description</Label>

              {product.description ? (
                <p className="mb-8 break-words leading-relaxed text-text-secondary">
                  {product.description}
                </p>
              ) : (
                <p className="mb-8 text-text-secondary">No description available.</p>
              )}

              <dl className="space-y-3 text-sm">
                {product.wax_type ? (
                  <div className="flex gap-2">
                    <dt className="font-medium uppercase tracking-[0.06em] text-text-secondary">
                      Wax type:
                    </dt>
                    <dd className="text-text">{product.wax_type}</dd>
                  </div>
                ) : null}
                {product.vessel_material ? (
                  <div className="flex gap-2">
                    <dt className="font-medium uppercase tracking-[0.06em] text-text-secondary">
                      Vessel material:
                    </dt>
                    <dd className="text-text">{product.vessel_material}</dd>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <dt className="font-medium uppercase tracking-[0.06em] text-text-secondary">
                    Category:
                  </dt>
                  <dd className="text-text">{category.name}</dd>
                </div>
              </dl>
            </div>

            <div className="min-w-0 lg:pl-12 xl:pl-16">
              <NoteColumns notes={notes} accords={accords} scentType={scentType} />
            </div>
          </div>
        </PageSection>
      ) : null}

      <SpecStrip primarySize={primarySize} brand={brand} />

      <RelatedProducts
        currentProduct={product}
        brandSlug={brand?.slug}
        brandName={brand?.name}
        categorySlug={category.slug}
      />
    </>
  )
}
